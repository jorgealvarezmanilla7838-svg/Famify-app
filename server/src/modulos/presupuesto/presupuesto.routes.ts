import express, { Response } from 'express';
import { pool } from '../../db';
import { PeticionGastos, cargarContexto, exigirPermiso } from '../gastos/gastos.permisos';
import { leerId } from '../gastos/gastos.validaciones';
import { leerMes, validarPresupuesto, validarCategorias } from './presupuesto.validaciones';
import { revisarPresupuestoYAvisar } from './presupuesto.alertas';

// MÓDULO 5: Presupuesto familiar (RF19 a RF22)
// RF19, RF20 y RF21 están en este archivo y el RF22 en presupuesto.alertas.ts

const router = express.Router();

router.use(cargarContexto);

const responderError = (res: Response, err: any, accion: string) => {
  console.error(`❌ Error al ${accion}:`, err.message);
  if (err.code === '42501') {
    return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
  }
  if (err.code === '23P01') {
    return res.status(400).json({ error: 'Ya existe un presupuesto que se traslapa con ese periodo.' });
  }
  if (err.code === 'P0001') {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === '23514' || err.code === '23503') {
    return res.status(400).json({ error: 'Los datos no cumplen las reglas del sistema.' });
  }
  return res.status(500).json({ error: 'Ocurrió un problema en el servidor. Intenta de nuevo.' });
};

const redondear = (n: number) => Math.round(n * 100) / 100;

// RF19, RF20 y RF21_ Consulta todo lo del mes: ingresos de la familia, gastos obligados,
// recomendación por categoría y el estado del presupuesto (gastado y disponible)
router.get('/', async (req: PeticionGastos, res: Response) => {
  const { familiaId, esAdmin } = req.contexto!;
  const periodo = leerMes(req.query.mes);
  if (!periodo) return res.status(400).json({ error: 'El mes indicado no es válido (usa AAAA-MM).' });

  try {
    // RF21_ Presupuesto del mes con lo gastado y lo disponible (vista v_presupuesto_estado)
    const ppto = await pool.query(
      `SELECT p.id, p.monto_total, p.umbral_alerta,
              e.gastado, e.disponible, e.porcentaje_usado,
              COALESCE((SELECT sum(monto_asignado) FROM presupuesto_por_categoria
                         WHERE presupuesto_id = p.id), 0) AS asignado_total
         FROM presupuesto p
         JOIN v_presupuesto_estado e ON e.presupuesto_id = p.id
        WHERE p.familia_id = $1::bigint AND p.fecha_inicio = $2::date AND p.fecha_fin = $3::date`,
      [familiaId, periodo.inicio, periodo.fin]
    );
    const presupuestoId = ppto.rows[0] ? Number(ppto.rows[0].id) : null;

    const [ingresos, fijos, historial, categorias] = await Promise.all([
      // RF19_ Ingreso mensual de cada integrante: su ingreso principal del cuestionario
      // más los ingresos que registró en el mes (Gestión de ingresos)
      pool.query(
        `SELECT u.id, u.nombre,
                COALESCE(c.ingreso_principal, 0) AS ingreso_base,
                COALESCE((SELECT sum(i.monto) FROM ingresos i
                           WHERE i.usuario_id = u.id AND i.familia_id = $1::bigint
                             AND i.fecha BETWEEN $2::date AND $3::date), 0) AS ingreso_registrado
           FROM usuario u
           LEFT JOIN configuracion_financiera c ON c.usuario_id = u.id
          WHERE u.familia_id = $1::bigint AND u.activo
          ORDER BY u.nombre`,
        [familiaId, periodo.inicio, periodo.fin]
      ),
      // RF19_ Gastos obligados: los gastos fijos que cada integrante puso en su cuestionario (RF08)
      pool.query(
        `SELECT CASE WHEN gf->>'categoria_id' ~ '^[0-9]+$' THEN (gf->>'categoria_id')::bigint END AS categoria_id,
                COALESCE(sum((gf->>'monto')::numeric), 0) AS total
           FROM configuracion_financiera c
           JOIN usuario u ON u.id = c.usuario_id AND u.activo AND u.familia_id = $1::bigint
          CROSS JOIN LATERAL jsonb_array_elements(c.gastos_fijos) gf
          GROUP BY 1`,
        [familiaId]
      ),
      // RF20_ Lo que la familia ha gastado por categoría en los 3 meses anteriores
      pool.query(
        `SELECT categoria_id, sum(monto) AS total
           FROM gastos
          WHERE familia_id = $1::bigint
            AND fecha >= ($2::date - interval '3 months') AND fecha < $2::date
          GROUP BY categoria_id`,
        [familiaId, periodo.inicio]
      ),
      // RF20_ y RF21_ Categorías con su monto asignado y lo gastado en el mes
      pool.query(
        `SELECT c.id, c.nombre,
                COALESCE(pc.monto_asignado, 0) AS asignado,
                COALESCE(g.total, 0) AS gastado
           FROM categoria_de_los_gastos c
           LEFT JOIN presupuesto_por_categoria pc
                  ON pc.categoria_id = c.id AND pc.presupuesto_id = $2::bigint
           LEFT JOIN (SELECT categoria_id, sum(monto) AS total FROM gastos
                       WHERE familia_id = $1::bigint AND fecha BETWEEN $3::date AND $4::date
                       GROUP BY categoria_id) g ON g.categoria_id = c.id
          WHERE c.activa AND (c.familia_id IS NULL OR c.familia_id = $1::bigint)
          ORDER BY c.nombre`,
        [familiaId, presupuestoId, periodo.inicio, periodo.fin]
      ),
    ]);

    const miembros = ingresos.rows.map((m: any) => ({
      id: Number(m.id),
      nombre: m.nombre,
      ingreso_base: Number(m.ingreso_base),
      ingreso_registrado: Number(m.ingreso_registrado),
      ingreso_mensual: Number(m.ingreso_base) + Number(m.ingreso_registrado),
    }));
    const ingresoTotal = miembros.reduce((suma, m) => suma + m.ingreso_mensual, 0);
    const gastosFijosTotal = fijos.rows.reduce((suma: number, f: any) => suma + Number(f.total), 0);

    const fijosPorCategoria = new Map<number, number>();
    for (const f of fijos.rows) {
      if (f.categoria_id !== null) fijosPorCategoria.set(Number(f.categoria_id), Number(f.total));
    }
    const promedioPorCategoria = new Map<number, number>();
    for (const h of historial.rows) {
      promedioPorCategoria.set(Number(h.categoria_id), Number(h.total) / 3);
    }

    // RF20_ Recomendación por categoría: lo mayor entre los gastos fijos y el promedio de 3 meses
    const listaCategorias = categorias.rows.map((c: any) => {
      const id = Number(c.id);
      const fijosCat = redondear(fijosPorCategoria.get(id) ?? 0);
      const promedio = redondear(promedioPorCategoria.get(id) ?? 0);
      return {
        id,
        nombre: c.nombre,
        fijos: fijosCat,
        promedio,
        recomendado: Math.max(fijosCat, promedio),
        asignado: Number(c.asignado),
        gastado: Number(c.gastado),
      };
    });

    const p = ppto.rows[0];
    const asignadoTotal = p ? Number(p.asignado_total) : 0;

    return res.json({
      success: true,
      mes: periodo.mes,
      periodo: periodo.periodo,
      es_admin: esAdmin,
      ingreso_total: redondear(ingresoTotal),
      gastos_fijos_total: redondear(gastosFijosTotal),
      // el detalle de cada integrante lo ve solo el administrador
      miembros: esAdmin ? miembros : [],
      presupuesto: p
        ? {
            id: Number(p.id),
            monto_total: Number(p.monto_total),
            umbral_alerta: Number(p.umbral_alerta),
            gastado: Number(p.gastado),
            disponible: Number(p.disponible),
            porcentaje_usado: Number(p.porcentaje_usado),
            asignado_total: asignadoTotal,
            sin_asignar: redondear(Number(p.monto_total) - asignadoTotal),
          }
        : null,
      categorias: listaCategorias,
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar el presupuesto');
  }
});

// RF19_ Creación de presupuesto (si el mes ya tiene uno, se actualiza el monto)
router.post('/', exigirPermiso('presupuesto.gestionar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  const periodo = leerMes(req.body?.mes);
  if (!periodo) return res.status(400).json({ error: 'El mes indicado no es válido (usa AAAA-MM).' });

  const { errores, datos } = validarPresupuesto(req.body);
  if (errores.length > 0) {
    return res.status(400).json({ error: errores.join(' '), errores });
  }

  try {
    const existente = await pool.query(
      'SELECT id FROM presupuesto WHERE familia_id = $1::bigint AND fecha_inicio = $2::date AND fecha_fin = $3::date',
      [familiaId, periodo.inicio, periodo.fin]
    );

    let guardado;
    if (existente.rows.length > 0) {
      guardado = await pool.query(
        `UPDATE presupuesto SET monto_total = $2::numeric, umbral_alerta = $3::numeric
          WHERE id = $1::bigint RETURNING id, monto_total, umbral_alerta`,
        [existente.rows[0].id, datos.monto_total, datos.umbral_alerta]
      );
    } else {
      guardado = await pool.query(
        `INSERT INTO presupuesto (familia_id, creado_por, monto_total, periodo, fecha_inicio, fecha_fin, umbral_alerta)
         VALUES ($1::bigint, $2::bigint, $3::numeric, $4::varchar, $5::date, $6::date, $7::numeric)
         RETURNING id, monto_total, umbral_alerta`,
        [familiaId, usuarioId, datos.monto_total, periodo.periodo, periodo.inicio, periodo.fin, datos.umbral_alerta]
      );
    }

    // RF22_ si con el nuevo monto ya se pasó del límite, se avisa por correo
    void revisarPresupuestoYAvisar(familiaId);

    return res.status(existente.rows.length > 0 ? 200 : 201).json({
      success: true,
      message: existente.rows.length > 0 ? 'Presupuesto actualizado.' : 'Presupuesto creado con éxito.',
      presupuesto: guardado.rows[0],
    });
  } catch (err: any) {
    return responderError(res, err, 'guardar el presupuesto');
  }
});

// RF20_ Asignación de presupuesto por categoría (reemplaza la lista completa)
router.put('/:id/categorias', exigirPermiso('presupuesto.gestionar'), async (req: PeticionGastos, res: Response) => {
  const { familiaId } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'El id del presupuesto no es válido.' });

  const { errores, asignaciones } = validarCategorias(req.body);
  if (errores.length > 0) {
    return res.status(400).json({ error: errores.join(' '), errores });
  }

  let cliente;
  try {
    cliente = await pool.connect();
  } catch (err: any) {
    return responderError(res, err, 'conectar para guardar las categorías');
  }

  let transaccionIniciada = false;
  try {
    const ppto = await cliente.query(
      'SELECT monto_total FROM presupuesto WHERE id = $1::bigint AND familia_id = $2::bigint',
      [id, familiaId]
    );
    if (ppto.rows.length === 0) {
      return res.status(404).json({ error: 'Presupuesto no encontrado.' });
    }

    const suma = asignaciones.reduce((total, a) => total + a.monto_asignado, 0);
    if (redondear(suma) > Number(ppto.rows[0].monto_total)) {
      return res.status(400).json({
        error: 'La suma de las categorías no puede ser mayor al presupuesto total del mes.',
      });
    }

    await cliente.query('BEGIN');
    transaccionIniciada = true;
    await cliente.query('DELETE FROM presupuesto_por_categoria WHERE presupuesto_id = $1::bigint', [id]);
    for (const a of asignaciones) {
      await cliente.query(
        `INSERT INTO presupuesto_por_categoria (presupuesto_id, categoria_id, monto_asignado)
         VALUES ($1::bigint, $2::bigint, $3::numeric)`,
        [id, a.categoria_id, a.monto_asignado]
      );
    }
    await cliente.query('COMMIT');
    transaccionIniciada = false;

    // RF22_ revisa si alguna categoría ya rebasó su límite con los nuevos montos
    void revisarPresupuestoYAvisar(familiaId);

    return res.json({ success: true, message: 'Presupuesto por categoría guardado.' });
  } catch (err: any) {
    if (transaccionIniciada) {
      try {
        await cliente.query('ROLLBACK');
      } catch (rollbackError: any) {
        console.error('Error al revertir el presupuesto por categoría:', rollbackError.message);
      }
    }
    return responderError(res, err, 'guardar el presupuesto por categoría');
  } finally {
    cliente.release();
  }
});

export default router;
