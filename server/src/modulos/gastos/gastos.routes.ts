import express, { Response } from 'express';
import { pool } from '../../db';
import { PeticionGastos, cargarContexto, exigirPermiso } from './gastos.permisos';
import { validarGasto, leerPeriodo, leerId } from './gastos.validaciones';

const router = express.Router();

router.use(cargarContexto);

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

// RF15_ y RF16_ Catálogos adaptados a famify_db.sql
router.get('/catalogos', async (req: PeticionGastos, res: Response) => {
  const { familiaId } = req.contexto!;
  try {
    const categorias = await pool.query(
      `SELECT id, nombre FROM categoria_de_los_gastos
        WHERE activa AND (familia_id IS NULL OR familia_id = $1::bigint)
        ORDER BY nombre`,
      [familiaId]
    );

    // Mapeo alineado al CHECK de la tabla `gastos` en famify_db.sql
    const metodosEstaticos = [
      { id: 'efectivo', nombre: 'Efectivo', es_credito: false },
      { id: 'tarjeta_debito', nombre: 'Tarjeta de Débito', es_credito: false },
      { id: 'tarjeta_credito', nombre: 'Tarjeta de Crédito', es_credito: true },
      { id: 'otro', nombre: 'Otro', es_credito: false }
    ];

    return res.json({ success: true, categorias: categorias.rows, metodos_pago: metodosEstaticos });
  } catch (err: any) {
    return responderError(res, err, 'consultar catálogos');
  }
});

// RF13_ Registro de gastos
router.post('/', exigirPermiso('gastos.registrar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  const { errores, datos } = validarGasto(req.body);

  if (errores.length > 0) {
    return res.status(400).json({ error: errores.join(' '), errores });
  }

  // Si envían un ID numérico de método de pago, se asigna 'efectivo' como predeterminado para cumplir el CHECK
  const metodoPago = typeof datos.metodo_pago_id === 'string' ? datos.metodo_pago_id : 'efectivo';

  try {
    const r = await pool.query(
      `INSERT INTO gastos (familia_id, usuario_id, categoria_id, metodo_de_pago, monto, fecha, descripcion)
       VALUES ($1::bigint, $2::bigint, $3::bigint, $4::varchar, $5::numeric,
               COALESCE($6::date, current_date), $7)
       RETURNING id, monto, to_char(fecha, 'YYYY-MM-DD') AS fecha`,
      [familiaId, usuarioId, datos.categoria_id, metodoPago, datos.monto, datos.fecha, datos.descripcion]
    );
    return res.status(201).json({ success: true, message: 'Gasto registrado con éxito.', gasto: r.rows[0] });
  } catch (err: any) {
    return responderError(res, err, 'registrar el gasto');
  }
});

// RF14_ Edición de gastos
router.put('/:id', exigirPermiso('gastos.editar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'El id del gasto no es válido.' });

  const { errores, datos } = validarGasto(req.body);
  if (errores.length > 0) {
    return res.status(400).json({ error: errores.join(' '), errores });
  }

  const metodoPago = typeof datos.metodo_pago_id === 'string' ? datos.metodo_pago_id : 'efectivo';

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
          SET categoria_id = $3::bigint, metodo_de_pago = $4::varchar, monto = $5::numeric,
              fecha = COALESCE($6::date, fecha), descripcion = $7
        WHERE id = $1::bigint AND familia_id = $2::bigint
        RETURNING id, monto, to_char(fecha, 'YYYY-MM-DD') AS fecha`,
      [id, familiaId, datos.categoria_id, metodoPago, datos.monto, datos.fecha, datos.descripcion]
    );
    return res.json({ success: true, message: 'Gasto actualizado.', gasto: r.rows[0] });
  } catch (err: any) {
    return responderError(res, err, 'editar el gasto');
  }
});

// RF14_ Eliminación de gastos
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

// RF17_ Consulta de gastos por periodo (Usando g.metodo_de_pago)
router.get('/', async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;

  const periodo = leerPeriodo(req.query);
  if (periodo.error) return res.status(400).json({ error: periodo.error });

  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const limite = Math.min(100, Math.max(1, Number(req.query.limite) || 20));

  const valores: any[] = [familiaId, periodo.desde, periodo.hasta];
  const filtros = ['g.familia_id = $1::bigint', 'g.fecha BETWEEN $2::date AND $3::date'];

  const usuarioFiltro = req.query.usuario_id ? leerId(req.query.usuario_id) : null;
  if (req.query.usuario_id && !usuarioFiltro) {
    return res.status(400).json({ error: 'El integrante indicado no es válido.' });
  }

  if (!esAdmin) {
    if (usuarioFiltro && usuarioFiltro !== usuarioId) {
      return res.status(403).json({ error: 'Solo el administrador puede ver el detalle de otros integrantes.' });
    }
    valores.push(usuarioId);
    filtros.push(`g.usuario_id = $${valores.length}::bigint`);
  } else if (usuarioFiltro) {
    valores.push(usuarioFiltro);
    filtros.push(`g.usuario_id = $${valores.length}::bigint`);
  }

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
                g.metodo_de_pago AS metodo_pago,
                g.usuario_id, u.nombre AS integrante
           FROM gastos g
           JOIN categoria_de_los_gastos c ON c.id = g.categoria_id
           JOIN usuario u ON u.id = g.usuario_id
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
      gastos: filas.rows.map((gasto: any) => ({
        ...gasto,
        es_mio: Number(gasto.usuario_id) === usuarioId,
      })),
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar los gastos');
  }
});

export default router;