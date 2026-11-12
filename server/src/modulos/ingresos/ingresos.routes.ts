import { Router, type Response } from 'express';
import { pool } from '../../db';
import { responderError } from '../compartido/errores';
import { type PeticionGastos, cargarContexto, exigirPermiso } from '../gastos/gastos.permisos';
import { leerId, leerPeriodo } from '../gastos/gastos.validaciones';
import { validarIngreso } from './ingresos.validaciones';

const router = Router();

router.use(cargarContexto);

// Columnas que se devuelven al cliente (en la base la clasificación se llama tipo_de_ingreso, RF011)
const COLUMNAS = `id, to_char(fecha, 'YYYY-MM-DD') AS fecha, monto, fuente, tipo_de_ingreso AS tipo, periodicidad`;

// RF012_ Consulta de ingresos propios por periodo
router.get('/', async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  const periodo = leerPeriodo(req.query);
  if (periodo.error) return res.status(400).json({ error: periodo.error });

  const valores = [familiaId, usuarioId, periodo.desde, periodo.hasta];
  const filtros = [
    'i.familia_id = $1::bigint',
    'i.usuario_id = $2::bigint',
    'i.fecha BETWEEN $3::date AND $4::date',
  ];

  try {
    const [totales, filas] = await Promise.all([
      pool.query(
        `SELECT COALESCE(sum(i.monto), 0) AS total, count(*) AS cantidad
           FROM ingresos i WHERE ${filtros.join(' AND ')}`,
        valores
      ),
      pool.query(
        `SELECT i.id, to_char(i.fecha, 'YYYY-MM-DD') AS fecha, i.monto, i.fuente,
                i.tipo_de_ingreso AS tipo, i.periodicidad, i.usuario_id
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
        id: String(ingreso.id),
        usuario_id: Number(ingreso.usuario_id),
        es_mio: Number(ingreso.usuario_id) === usuarioId,
      })),
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar los ingresos');
  }
});

// RF09_ Registro de ingresos. RF011_ con su clasificación (salario, tanda, préstamo u otro)
// El trigger de la base de datos revisa el permiso ingresos.registrar y que el usuario recibe sueldo (RF05)
router.post('/', exigirPermiso('ingresos.registrar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  const { errores, datos } = validarIngreso(req.body);
  if (errores.length > 0) return res.status(400).json({ error: errores.join(' '), errores });

  try {
    const ingreso = await pool.query(
      `INSERT INTO ingresos (familia_id, usuario_id, monto, fuente, tipo_de_ingreso, periodicidad, fecha)
       VALUES ($1::bigint, $2::bigint, $3::numeric, $4::varchar, $5::varchar, $6::varchar,
               COALESCE($7::date, current_date))
       RETURNING ${COLUMNAS}`,
      [familiaId, usuarioId, datos.monto, datos.fuente, datos.tipo, datos.periodicidad, datos.fecha]
    );
    return res.status(201).json({ success: true, ingreso: { ...ingreso.rows[0], id: String(ingreso.rows[0].id) } });
  } catch (err: any) {
    return responderError(res, err, 'registrar el ingreso');
  }
});

// RF010_ Edición de ingresos propios
router.put('/:id', exigirPermiso('ingresos.editar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'El id del ingreso no es válido.' });

  const { errores, datos } = validarIngreso(req.body);
  if (errores.length > 0) return res.status(400).json({ error: errores.join(' '), errores });

  try {
    const existente = await pool.query(
      'SELECT usuario_id FROM ingresos WHERE id = $1::bigint AND familia_id = $2::bigint',
      [id, familiaId]
    );
    if (existente.rows.length === 0) return res.status(404).json({ error: 'Ingreso no encontrado.' });
    if (Number(existente.rows[0].usuario_id) !== usuarioId) {
      return res.status(403).json({ error: 'Solo puedes modificar tus propios ingresos.' });
    }

    const ingreso = await pool.query(
      `UPDATE ingresos
          SET monto = $3::numeric, fuente = $4::varchar, tipo_de_ingreso = $5::varchar,
              periodicidad = $6::varchar, fecha = COALESCE($7::date, fecha)
        WHERE id = $1::bigint AND familia_id = $2::bigint
        RETURNING ${COLUMNAS}`,
      [id, familiaId, datos.monto, datos.fuente, datos.tipo, datos.periodicidad, datos.fecha]
    );
    return res.json({ success: true, ingreso: { ...ingreso.rows[0], id: String(ingreso.rows[0].id) } });
  } catch (err: any) {
    return responderError(res, err, 'editar el ingreso');
  }
});

// RF010_ Eliminación de ingresos propios
router.delete('/:id', exigirPermiso('ingresos.editar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'El id del ingreso no es válido.' });

  try {
    const existente = await pool.query(
      'SELECT usuario_id FROM ingresos WHERE id = $1::bigint AND familia_id = $2::bigint',
      [id, familiaId]
    );
    if (existente.rows.length === 0) return res.status(404).json({ error: 'Ingreso no encontrado.' });
    if (Number(existente.rows[0].usuario_id) !== usuarioId) {
      return res.status(403).json({ error: 'Solo puedes eliminar tus propios ingresos.' });
    }

    await pool.query('DELETE FROM ingresos WHERE id = $1::bigint AND familia_id = $2::bigint', [id, familiaId]);
    return res.json({ success: true, message: 'Ingreso eliminado.' });
  } catch (err: any) {
    return responderError(res, err, 'eliminar el ingreso');
  }
});

export default router;
