import { Router, type Response } from 'express';
import { pool } from '../../db';
import { type PeticionGastos, cargarContexto } from '../gastos/gastos.permisos';
import { leerPeriodo } from '../gastos/gastos.validaciones';
import { validarIngreso } from './ingresos.validaciones';

const router = Router();

router.use(cargarContexto);

const responderError = (res: Response, err: any, accion: string) => {
  console.error(`Error al ${accion}:`, err.message);
  if (err.code === '23514' || err.code === '23503') {
    return res.status(400).json({ error: 'Los datos no cumplen las reglas del sistema.' });
  }
  return res.status(500).json({ error: 'Ocurrió un problema en el servidor. Intenta de nuevo.' });
};

router.get('/', async (req: PeticionGastos, res: Response) => {
  const { usuarioId } = req.contexto!;
  const periodo = leerPeriodo(req.query);
  if (periodo.error) return res.status(400).json({ error: periodo.error });

  const valores = [String(usuarioId), periodo.desde, periodo.hasta];
  const filtros = [
    'i.usuario_id = $1::varchar',
    'COALESCE(i.fecha, current_timestamp) >= $2::date',
    'COALESCE(i.fecha, current_timestamp) < ($3::date + interval \'1 day\')',
  ];

  try {
    const [totales, filas] = await Promise.all([
      pool.query(
        `SELECT COALESCE(sum(i.monto), 0) AS total, count(*) AS cantidad
           FROM ingresos i WHERE ${filtros.join(' AND ')}`,
        valores
      ),
      pool.query(
        `SELECT i.id, to_char(COALESCE(i.fecha, current_timestamp), 'YYYY-MM-DD') AS fecha,
                i.monto, i.fuente, i.tipo, i.periodicidad, i.usuario_id
           FROM ingresos i
          WHERE ${filtros.join(' AND ')}
          ORDER BY i.fecha DESC, i.id DESC`,
        valores
      ),
    ]);

    return res.json({
      success: true,
      periodo: { desde: periodo.desde, hasta: periodo.hasta },
      alcance: 'personal',
      total: totales.rows[0].total,
      cantidad: Number(totales.rows[0].cantidad),
      ingresos: filas.rows.map((ingreso: any) => ({
        ...ingreso,
        es_mio: ingreso.usuario_id === String(usuarioId),
      })),
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar los ingresos');
  }
});

router.post('/', async (req: PeticionGastos, res: Response) => {
  const { usuarioId } = req.contexto!;
  const { errores, datos } = validarIngreso(req.body);
  if (errores.length > 0) return res.status(400).json({ error: errores.join(' '), errores });

  try {
    const ingreso = await pool.query(
      `INSERT INTO ingresos (usuario_id, monto, fuente, tipo, periodicidad, fecha)
       VALUES ($1::varchar, $2::numeric, $3::varchar, $4::varchar, $5::varchar,
               COALESCE($6::date, current_date))
       RETURNING id, to_char(fecha, 'YYYY-MM-DD') AS fecha, monto, fuente, tipo, periodicidad`,
      [String(usuarioId), datos.monto, datos.fuente, datos.tipo, datos.periodicidad, datos.fecha]
    );
    return res.status(201).json({ success: true, ingreso: ingreso.rows[0] });
  } catch (err: any) {
    return responderError(res, err, 'registrar el ingreso');
  }
});

router.put('/:id', async (req: PeticionGastos, res: Response) => {
  const { usuarioId } = req.contexto!;
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'El id del ingreso no es válido.' });
  }

  const { errores, datos } = validarIngreso(req.body);
  if (errores.length > 0) return res.status(400).json({ error: errores.join(' '), errores });

  try {
    const existente = await pool.query(
      'SELECT usuario_id FROM ingresos WHERE id = $1::uuid',
      [id]
    );
    if (existente.rows.length === 0) return res.status(404).json({ error: 'Ingreso no encontrado.' });
    if (existente.rows[0].usuario_id !== String(usuarioId)) {
      return res.status(403).json({ error: 'Solo puedes modificar tus propios ingresos.' });
    }

    const ingreso = await pool.query(
      `UPDATE ingresos
          SET monto = $2::numeric, fuente = $3::varchar, tipo = $4::varchar,
              periodicidad = $5::varchar, fecha = COALESCE($6::date, fecha)
        WHERE id = $1::uuid
        RETURNING id, to_char(fecha, 'YYYY-MM-DD') AS fecha, monto, fuente, tipo, periodicidad`,
      [id, datos.monto, datos.fuente, datos.tipo, datos.periodicidad, datos.fecha]
    );
    return res.json({ success: true, ingreso: ingreso.rows[0] });
  } catch (err: any) {
    return responderError(res, err, 'editar el ingreso');
  }
});

router.delete('/:id', async (req: PeticionGastos, res: Response) => {
  const { usuarioId } = req.contexto!;
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'El id del ingreso no es válido.' });
  }

  try {
    const existente = await pool.query(
      'SELECT usuario_id FROM ingresos WHERE id = $1::uuid',
      [id]
    );
    if (existente.rows.length === 0) return res.status(404).json({ error: 'Ingreso no encontrado.' });
    if (existente.rows[0].usuario_id !== String(usuarioId)) {
      return res.status(403).json({ error: 'Solo puedes eliminar tus propios ingresos.' });
    }

    await pool.query('DELETE FROM ingresos WHERE id = $1::uuid', [id]);
    return res.json({ success: true, message: 'Ingreso eliminado.' });
  } catch (err: any) {
    return responderError(res, err, 'eliminar el ingreso');
  }
});

export default router;
