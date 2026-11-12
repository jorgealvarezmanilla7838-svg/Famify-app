import { Router, type Response } from 'express';
import { pool } from '../../db';
import { responderError } from '../compartido/errores';
import { type PeticionGastos, cargarContexto } from '../gastos/gastos.permisos';
import { leerId } from '../gastos/gastos.validaciones';

const router = Router();
router.use(cargarContexto);

// La tabla notificacion guarda tipo y mensaje; el título se arma a partir del tipo
const TITULOS: Record<string, string> = {
  corte: 'Fecha de corte próxima',
  limite_pago: 'Fecha límite de pago próxima',
  gasto_fijo: 'Gasto fijo próximo',
  presupuesto: 'Aviso de presupuesto',
  deficit: 'Déficit detectado',
};

router.get('/', async (req: PeticionGastos, res: Response) => {
  try {
    const filas = await pool.query(
      `SELECT n.id, n.tipo, n.mensaje, n.leida_en IS NOT NULL AS leida,
              to_char(n.fecha AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS fecha
         FROM notificacion n WHERE n.usuario_id = $1::bigint
        ORDER BY n.fecha DESC, n.id DESC LIMIT 100`,
      [req.contexto!.usuarioId]
    );
    const notificaciones = filas.rows.map((n: any) => ({
      ...n,
      id: Number(n.id),
      titulo: TITULOS[n.tipo] ?? 'Aviso',
    }));
    return res.json({
      success: true,
      sin_leer: notificaciones.filter((n: any) => !n.leida).length,
      notificaciones,
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar las notificaciones');
  }
});

router.post('/leer-todas', async (req: PeticionGastos, res: Response) => {
  try {
    await pool.query('UPDATE notificacion SET leida_en = now() WHERE usuario_id = $1::bigint AND leida_en IS NULL', [
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
      'UPDATE notificacion SET leida_en = COALESCE(leida_en, now()) WHERE id = $1::bigint AND usuario_id = $2::bigint',
      [id, req.contexto!.usuarioId]
    );
    return res.json({ success: true });
  } catch (err: any) {
    return responderError(res, err, 'marcar la notificación');
  }
});

export default router;
