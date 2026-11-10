import { Router, type Response } from 'express';
import { pool } from '../../db';
import { responderError } from '../compartido/errores';
import { type PeticionGastos, cargarContexto } from '../gastos/gastos.permisos';
import { leerId } from '../gastos/gastos.validaciones';

const router = Router();
router.use(cargarContexto);

router.get('/', async (req: PeticionGastos, res: Response) => {
  try {
    const filas = await pool.query(
      `SELECT id, tipo, titulo, mensaje, leida_en IS NOT NULL AS leida,
              to_char(created_at, 'YYYY-MM-DD') AS fecha
         FROM notificaciones WHERE usuario_id = $1::bigint
        ORDER BY created_at DESC, id DESC LIMIT 100`,
      [req.contexto!.usuarioId]
    );
    return res.json({
      success: true,
      sin_leer: filas.rows.filter((n: any) => !n.leida).length,
      notificaciones: filas.rows,
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar las notificaciones');
  }
});

router.post('/leer-todas', async (req: PeticionGastos, res: Response) => {
  try {
    await pool.query('UPDATE notificaciones SET leida_en = now() WHERE usuario_id = $1::bigint AND leida_en IS NULL', [
      req.contexto!.usuarioId,
    ]);
    return res.json({ success: true });
  } catch (err: any) {
    return responderError(res, err, 'marcar las notificaciones');
  }
});

router.post('/:id/leer', async (req: PeticionGastos, res: Response) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'La notificación indicada no es válida.' });
  try {
    await pool.query(
      'UPDATE notificaciones SET leida_en = COALESCE(leida_en, now()) WHERE id = $1::bigint AND usuario_id = $2::bigint',
      [id, req.contexto!.usuarioId]
    );
    return res.json({ success: true });
  } catch (err: any) {
    return responderError(res, err, 'marcar la notificación');
  }
});

export default router;
