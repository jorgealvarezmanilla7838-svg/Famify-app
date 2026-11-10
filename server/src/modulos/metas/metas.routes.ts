import { Router, type Response } from 'express';
import { enTransaccion, pool } from '../../db';
import { ErrorNegocio, montoValido, responderError, textoRecortado } from '../compartido/errores';
import { type PeticionGastos, cargarContexto, exigirPermiso } from '../gastos/gastos.permisos';
import { esFechaValida, fechaLocal, leerId } from '../gastos/gastos.validaciones';
import { listarMetas } from './metas.servicio';

const router = Router();
router.use(cargarContexto);

const validarMeta = (body: any) => {
  const errores: string[] = [];
  const nombre = textoRecortado(body?.nombre);
  const descripcion = textoRecortado(body?.descripcion);
  if (!nombre || nombre.length > 100) errores.push('Nombre: es obligatorio y admite hasta 100 caracteres.');
  if (descripcion.length > 200) errores.push('Descripción: admite hasta 200 caracteres.');
  if (!montoValido(body?.monto_objetivo)) errores.push('Monto objetivo: escribe un número mayor a 0, con máximo 2 decimales.');
  const conFecha = body?.fecha_limite !== undefined && body?.fecha_limite !== null && body?.fecha_limite !== '';
  if (conFecha && !esFechaValida(body.fecha_limite)) errores.push('Fecha límite: selecciona una fecha válida.');
  return {
    errores,
    datos: {
      nombre,
      descripcion: descripcion || null,
      monto_objetivo: Number(body?.monto_objetivo),
      fecha_limite: conFecha ? (body.fecha_limite as string) : null,
    },
  };
};

// Meta que el usuario puede ver, o null si no existe para él (RNF04)
const metaVisible = `m.id = $1::bigint AND m.familia_id = $2::bigint
                     AND ($3::boolean OR m.usuario_id IS NULL OR m.usuario_id = $4::bigint)`;

// RF025_ Consulta del progreso
router.get('/', async (req: PeticionGastos, res: Response) => {
  try {
    return res.json({ success: true, metas: await listarMetas(req.contexto!) });
  } catch (err: any) {
    return responderError(res, err, 'consultar las metas');
  }
});

// RF023_ Creación de metas, de toda la familia o de un integrante
router.post('/', exigirPermiso('metas.crear'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;
  const { errores, datos } = validarMeta(req.body);
  if (req.body?.alcance !== 'familia' && req.body?.alcance !== 'personal') {
    errores.push('Para quién: indica si la meta es de la familia o personal.');
  }
  if (errores.length > 0) return res.status(400).json({ error: errores.join(' '), errores });

  let dueno: number | null = null;
  if (req.body.alcance === 'personal') {
    dueno = req.body.usuario_id ? leerId(req.body.usuario_id) : usuarioId;
    if (!dueno) return res.status(400).json({ error: 'Integrante: selecciona un integrante válido.' });
    if (dueno !== usuarioId && !esAdmin) {
      return res.status(403).json({ error: 'Solo el administrador puede crear metas para otros integrantes.' });
    }
  }

  try {
    if (dueno !== null) {
      const miembro = await pool.query('SELECT 1 FROM usuarios WHERE id = $1::bigint AND familia_id = $2::bigint AND activo', [
        dueno,
        familiaId,
      ]);
      if (miembro.rows.length === 0) return res.status(400).json({ error: 'Integrante: no pertenece a tu familia.' });
    }
    const creada = await pool.query(
      `INSERT INTO metas_ahorro (familia_id, usuario_id, nombre, descripcion, monto_objetivo, fecha_limite, creada_por)
       VALUES ($1::bigint, $2::bigint, $3::varchar, $4::varchar, $5::numeric, $6::date, $7::bigint) RETURNING id`,
      [familiaId, dueno, datos.nombre, datos.descripcion, datos.monto_objetivo, datos.fecha_limite, usuarioId]
    );
    return res.status(201).json({ success: true, message: 'Meta creada.', id: Number(creada.rows[0].id) });
  } catch (err: any) {
    return responderError(res, err, 'crear la meta');
  }
});

// RF026_ Modificación de metas
router.put('/:id', exigirPermiso('metas.editar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'La meta indicada no es válida.' });
  const { errores, datos } = validarMeta(req.body);
  if (errores.length > 0) return res.status(400).json({ error: errores.join(' '), errores });

  try {
    const meta = await pool.query(`SELECT m.usuario_id, m.creada_por FROM metas_ahorro m WHERE ${metaVisible}`, [
      id,
      familiaId,
      esAdmin,
      usuarioId,
    ]);
    if (meta.rows.length === 0) return res.status(404).json({ error: 'Meta no encontrada.' });
    const { usuario_id: dueno, creada_por: autor } = meta.rows[0];
    if (!esAdmin && Number(autor) !== usuarioId && Number(dueno) !== usuarioId) {
      return res.status(403).json({ error: 'Solo puedes modificar las metas que creaste.' });
    }
    await pool.query(
      `UPDATE metas_ahorro SET nombre = $2::varchar, descripcion = $3::varchar,
              monto_objetivo = $4::numeric, fecha_limite = $5::date
        WHERE id = $1::bigint`,
      [id, datos.nombre, datos.descripcion, datos.monto_objetivo, datos.fecha_limite]
    );
    return res.json({ success: true, message: 'Meta actualizada.' });
  } catch (err: any) {
    return responderError(res, err, 'actualizar la meta');
  }
});

// RF024_ Registro de aportaciones. RNF15_ aportación y progreso se guardan juntos.
router.post('/:id/aportaciones', exigirPermiso('metas.aportar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'La meta indicada no es válida.' });
  if (!montoValido(req.body?.monto)) {
    return res.status(400).json({ error: 'Monto: escribe un número mayor a 0, con máximo 2 decimales.' });
  }
  const conFecha = req.body?.fecha !== undefined && req.body?.fecha !== null && req.body?.fecha !== '';
  if (conFecha && (!esFechaValida(req.body.fecha) || req.body.fecha > fechaLocal(new Date()))) {
    return res.status(400).json({ error: 'Fecha: selecciona una fecha válida que no sea futura.' });
  }

  try {
    await enTransaccion(async (cliente) => {
      const meta = await cliente.query(`SELECT m.id FROM metas_ahorro m WHERE ${metaVisible} FOR UPDATE`, [
        id,
        familiaId,
        esAdmin,
        usuarioId,
      ]);
      if (meta.rows.length === 0) throw new ErrorNegocio(404, 'Meta no encontrada.');
      await cliente.query(
        `INSERT INTO aportaciones_meta (meta_id, usuario_id, monto, fecha)
         VALUES ($1::bigint, $2::bigint, $3::numeric, COALESCE($4::date, current_date))`,
        [id, usuarioId, Number(req.body.monto), conFecha ? req.body.fecha : null]
      );
      await cliente.query('UPDATE metas_ahorro SET monto_ahorrado = monto_ahorrado + $2::numeric WHERE id = $1::bigint', [
        id,
        Number(req.body.monto),
      ]);
    });
    return res.status(201).json({ success: true, message: 'Aportación registrada.' });
  } catch (err: any) {
    return responderError(res, err, 'registrar la aportación');
  }
});

router.get('/:id/aportaciones', async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId, esAdmin } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'La meta indicada no es válida.' });
  try {
    const meta = await pool.query(`SELECT m.id FROM metas_ahorro m WHERE ${metaVisible}`, [id, familiaId, esAdmin, usuarioId]);
    if (meta.rows.length === 0) return res.status(404).json({ error: 'Meta no encontrada.' });
    const filas = await pool.query(
      `SELECT a.id, a.monto, to_char(a.fecha, 'YYYY-MM-DD') AS fecha, u.nombre AS integrante
         FROM aportaciones_meta a JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.meta_id = $1::bigint ORDER BY a.fecha DESC, a.id DESC`,
      [id]
    );
    return res.json({ success: true, aportaciones: filas.rows });
  } catch (err: any) {
    return responderError(res, err, 'consultar las aportaciones');
  }
});

export default router;
