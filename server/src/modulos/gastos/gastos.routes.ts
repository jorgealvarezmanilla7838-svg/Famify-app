import { Router, Response } from 'express';
import { pool } from '../../db';
import { PeticionGastos, cargarContexto, exigirPermiso } from './gastos.permisos';
import { validarGasto, leerPeriodo, leerId } from './gastos.validaciones';
import { METODOS_PAGO } from '../../catalogos';

const router = Router();

// RNF04_ todas las rutas de gastos pasan primero por aqui para saber la familia y el rol
router.use(cargarContexto);

// errores que manda la base de datos (triggers y checks de famify_db.sql)
const responderError = (res: Response, err: any, accion: string) => {
  console.error(`❌ Error al ${accion}:`, err.message);
  if (err.code === '42501') {
    return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
  }
  if (err.code === 'P0001') {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === '23514' || err.code === '23503') {
    return res.status(400).json({ error: 'Los datos no cumplen las reglas del sistema.' });
  }
  return res.status(500).json({ error: 'Ocurrió un problema en el servidor. Intenta de nuevo.' });
};

// RF15_ y RF16_ Listas para los menus de categoría y método de pago
router.get('/catalogos', async (req: PeticionGastos, res: Response) => {
  const { familiaId } = req.contexto!;
  try {
    const [categorias, metodos] = await Promise.all([
      pool.query(
        `SELECT id, nombre FROM categoria_de_los_gastos
          WHERE activa AND (familia_id IS NULL OR familia_id = $1::bigint)
          ORDER BY nombre`,
        [familiaId]
      ),
      Promise.resolve(METODOS_PAGO.map(({ id, nombre }) => ({ id, nombre }))),
    ]);
    return res.json({ success: true, categorias: categorias.rows, metodos_pago: metodos });
  } catch (err: any) {
    return responderError(res, err, 'consultar catálogos');
  }
});

// RF13_ Registro de gastos (administrador e integrante, cada quien registra el suyo)
router.post('/', exigirPermiso('gastos.registrar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  const { errores, datos } = validarGasto(req.body);

  if (errores.length > 0) {
    return res.status(400).json({ error: errores.join(' '), errores });
  }

  try {
    const r = await pool.query(
      `INSERT INTO gastos (familia_id, usuario_id, categoria_id, metodo_de_pago, monto, fecha, descripcion)
       VALUES ($1::bigint, $2::bigint, $3::bigint, $4::text, $5::numeric,
               COALESCE($6::date, current_date), $7)
       RETURNING id, monto, to_char(fecha, 'YYYY-MM-DD') AS fecha`,
      [familiaId, usuarioId, datos.categoria_id, datos.metodo_de_pago, datos.monto, datos.fecha, datos.descripcion]
    );
    return res.status(201).json({ success: true, message: 'Gasto registrado con éxito.', gasto: r.rows[0] });
  } catch (err: any) {
    return responderError(res, err, 'registrar el gasto');
  }
});

// RF14_ Edición de gastos
// el administrador edita cualquiera de la familia, el integrante solo los suyos
router.put('/:id', exigirPermiso('gastos.editar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'El id del gasto no es válido.' });

  const { errores, datos } = validarGasto(req.body);
  if (errores.length > 0) {
    return res.status(400).json({ error: errores.join(' '), errores });
  }

  try {
    const gasto = await pool.query(
      'SELECT usuario_id FROM gastos WHERE id = $1::bigint AND familia_id = $2::bigint',
      [id, familiaId]
    );
    if (gasto.rows.length === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado.' });
    }
    if (!esAdmin && Number(gasto.rows[0].usuario_id) !== usuarioId) {
      return res.status(403).json({ error: 'Solo puedes modificar tus propios gastos.' });
    }

    const r = await pool.query(
      `UPDATE gastos
          SET categoria_id = $3::bigint, metodo_de_pago = $4::text, monto = $5::numeric,
              fecha = COALESCE($6::date, fecha), descripcion = $7
        WHERE id = $1::bigint AND familia_id = $2::bigint
        RETURNING id, monto, to_char(fecha, 'YYYY-MM-DD') AS fecha`,
      [id, familiaId, datos.categoria_id, datos.metodo_de_pago, datos.monto, datos.fecha, datos.descripcion]
    );
    return res.json({ success: true, message: 'Gasto actualizado.', gasto: r.rows[0] });
  } catch (err: any) {
    return responderError(res, err, 'editar el gasto');
  }
});

// RF14_ Eliminación de gastos (mismas reglas que la edición)
router.delete('/:id', exigirPermiso('gastos.editar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'El id del gasto no es válido.' });

  try {
    const gasto = await pool.query(
      'SELECT usuario_id FROM gastos WHERE id = $1::bigint AND familia_id = $2::bigint',
      [id, familiaId]
    );
    if (gasto.rows.length === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado.' });
    }
    if (!esAdmin && Number(gasto.rows[0].usuario_id) !== usuarioId) {
      return res.status(403).json({ error: 'Solo puedes eliminar tus propios gastos.' });
    }

    await pool.query('DELETE FROM gastos WHERE id = $1::bigint AND familia_id = $2::bigint', [id, familiaId]);
    return res.json({ success: true, message: 'Gasto eliminado.' });
  } catch (err: any) {
    return responderError(res, err, 'eliminar el gasto');
  }
});

// RF17_ Consulta de gastos por periodo (lista con detalle)
// administrador: todos los gastos de la familia (puede filtrar por integrante)
// integrante: solo sus propios gastos
router.get('/', async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;

  const periodo = leerPeriodo(req.query);
  if (periodo.error) return res.status(400).json({ error: periodo.error });

  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const limite = Math.min(100, Math.max(1, Number(req.query.limite) || 20));

  // $1 familia, $2 desde, $3 hasta (los demas filtros se van agregando)
  const valores: any[] = [familiaId, periodo.desde, periodo.hasta];
  const filtros = ['g.familia_id = $1::bigint', 'g.fecha BETWEEN $2::date AND $3::date'];

  const usuarioFiltro = req.query.usuario_id ? leerId(req.query.usuario_id) : null;
  if (req.query.usuario_id && !usuarioFiltro) {
    return res.status(400).json({ error: 'El integrante indicado no es válido.' });
  }

  if (!esAdmin) {
    // el integrante no puede ver el detalle de los demas
    if (usuarioFiltro && usuarioFiltro !== usuarioId) {
      return res.status(403).json({ error: 'Solo el administrador puede ver el detalle de otros integrantes.' });
    }
    valores.push(usuarioId);
    filtros.push(`g.usuario_id = $${valores.length}::bigint`);
  } else if (usuarioFiltro) {
    valores.push(usuarioFiltro);
    filtros.push(`g.usuario_id = $${valores.length}::bigint`);
  }

  // RF15_ filtro opcional por categoría
  if (req.query.categoria_id) {
    const cat = leerId(req.query.categoria_id);
    if (!cat) return res.status(400).json({ error: 'La categoría indicada no es válida.' });
    valores.push(cat);
    filtros.push(`g.categoria_id = $${valores.length}::bigint`);
  }

  const where = filtros.join(' AND ');

  try {
    const [totales, filas] = await Promise.all([
      pool.query(`SELECT COALESCE(sum(g.monto), 0) AS total, count(*) AS cantidad FROM gastos g WHERE ${where}`, valores),
      pool.query(
        `SELECT g.id, to_char(g.fecha, 'YYYY-MM-DD') AS fecha, g.monto, g.descripcion,
                g.categoria_id, c.nombre AS categoria,
                g.metodo_de_pago,
                g.usuario_id, u.nombre AS integrante
           FROM gastos g
           JOIN categoria_de_los_gastos c ON c.id = g.categoria_id
           JOIN usuario u                 ON u.id = g.usuario_id
          WHERE ${where}
          ORDER BY g.fecha DESC, g.id DESC
          LIMIT ${limite} OFFSET ${(pagina - 1) * limite}`,
        valores
      ),
    ]);

    return res.json({
      success: true,
      periodo: { desde: periodo.desde, hasta: periodo.hasta },
      alcance: esAdmin ? 'familia' : 'personal',
      total: totales.rows[0].total,
      cantidad: Number(totales.rows[0].cantidad),
      pagina,
      limite,
      gastos: filas.rows.map(({ metodo_de_pago, ...f }: any) => {
        // el cliente sigue recibiendo metodo_pago_id y metodo_pago como antes
        const metodo = METODOS_PAGO.find((m) => m.codigo === metodo_de_pago);
        return {
          ...f,
          metodo_pago_id: metodo?.id ?? null,
          metodo_pago: metodo?.nombre ?? metodo_de_pago,
          es_mio: Number(f.usuario_id) === usuarioId,
        };
      }),
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar los gastos');
  }
});

// RF17_ Consulta de gastos por periodo (totales)
// los dos roles ven el total general de la familia y el total propio
// solo el administrador ve cuanto gastó cada integrante
router.get('/resumen', exigirPermiso('reportes.ver'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;

  const periodo = leerPeriodo(req.query);
  if (periodo.error) return res.status(400).json({ error: periodo.error });

  try {
    const totales = await pool.query(
      `SELECT COALESCE(sum(monto), 0) AS total_familia,
              count(*) AS cantidad_familia,
              COALESCE(sum(monto) FILTER (WHERE usuario_id = $4::bigint), 0) AS total_mio,
              count(*) FILTER (WHERE usuario_id = $4::bigint) AS cantidad_mio
         FROM gastos
        WHERE familia_id = $1::bigint AND fecha BETWEEN $2::date AND $3::date`,
      [familiaId, periodo.desde, periodo.hasta, usuarioId]
    );
    const t = totales.rows[0];

    const respuesta: any = {
      success: true,
      periodo: { desde: periodo.desde, hasta: periodo.hasta },
      familia: { total: t.total_familia, cantidad: Number(t.cantidad_familia) },
      mio: { total: t.total_mio, cantidad: Number(t.cantidad_mio) },
    };

    if (esAdmin) {
      const porIntegrante = await pool.query(
        `SELECT u.id, u.nombre, sum(g.monto) AS total, count(*) AS cantidad
           FROM gastos g JOIN usuario u ON u.id = g.usuario_id
          WHERE g.familia_id = $1::bigint AND g.fecha BETWEEN $2::date AND $3::date
          GROUP BY u.id, u.nombre
          ORDER BY sum(g.monto) DESC`,
        [familiaId, periodo.desde, periodo.hasta]
      );
      respuesta.por_integrante = porIntegrante.rows.map((f: any) => ({ ...f, cantidad: Number(f.cantidad) }));
    }

    return res.json(respuesta);
  } catch (err: any) {
    return responderError(res, err, 'consultar el resumen de gastos');
  }
});

// RF18_ Consulta de gastos por categoría
// alcance=familia (por defecto): general de la familia, sin nombres ni detalle
// alcance=mio: solo mis gastos
// usuario_id=X: solo lo puede usar el administrador para ver a un integrante
router.get('/por-categoria', exigirPermiso('reportes.ver'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;

  const periodo = leerPeriodo(req.query);
  if (periodo.error) return res.status(400).json({ error: periodo.error });

  const usuarioFiltro = req.query.usuario_id ? leerId(req.query.usuario_id) : null;
  if (req.query.usuario_id && !usuarioFiltro) {
    return res.status(400).json({ error: 'El integrante indicado no es válido.' });
  }
  if (!esAdmin && usuarioFiltro && usuarioFiltro !== usuarioId) {
    return res.status(403).json({ error: 'Solo el administrador puede ver el detalle de otros integrantes.' });
  }

  // si piden "mio" o un integrante en especifico, se filtra por usuario
  const usuarioObjetivo = usuarioFiltro ?? (req.query.alcance === 'mio' ? usuarioId : null);

  try {
    let filas;
    if (usuarioObjetivo === null) {
      // general de la familia, se usa la función que ya está en la base de datos
      filas = await pool.query(
        'SELECT categoria_id, categoria, total, porcentaje FROM fn_gastos_por_categoria($1::bigint, $2::date, $3::date)',
        [familiaId, periodo.desde, periodo.hasta]
      );
    } else {
      filas = await pool.query(
        `SELECT c.id AS categoria_id, c.nombre AS categoria, sum(g.monto) AS total,
                round(100 * sum(g.monto) / NULLIF(sum(sum(g.monto)) OVER (), 0), 2) AS porcentaje
           FROM gastos g JOIN categoria_de_los_gastos c ON c.id = g.categoria_id
          WHERE g.familia_id = $1::bigint AND g.usuario_id = $4::bigint
            AND g.fecha BETWEEN $2::date AND $3::date
          GROUP BY c.id, c.nombre
          ORDER BY sum(g.monto) DESC`,
        [familiaId, periodo.desde, periodo.hasta, usuarioObjetivo]
      );
    }

    const total = filas.rows.reduce((suma: number, f: any) => suma + Number(f.total), 0);
    return res.json({
      success: true,
      periodo: { desde: periodo.desde, hasta: periodo.hasta },
      alcance: usuarioObjetivo === null ? 'familia' : 'personal',
      total: total.toFixed(2),
      categorias: filas.rows,
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar gastos por categoría');
  }
});

export default router;
