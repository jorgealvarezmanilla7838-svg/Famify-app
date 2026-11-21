import { Router, type Response } from 'express';
import { responderError } from '../compartido/errores';
import { type PeticionGastos, cargarContexto, exigirPermiso } from '../gastos/gastos.permisos';
import { leerId, leerPeriodo } from '../gastos/gastos.validaciones';
import { listarMetas } from '../metas/metas.servicio';
import { obtenerCategorias, obtenerMovimientos, obtenerPorMes, obtenerTotales } from './reportes.servicio';

// Atiende el Resumen financiero (RF027 a RF031) y los Reportes (RF041 a RF043)
const router = Router();
router.use(cargarContexto, exigirPermiso('reportes.ver'));

router.get('/resumen', async (req: PeticionGastos, res: Response) => {
  const contexto = req.contexto!;
  const periodo = leerPeriodo(req.query);
  if (periodo.error) return res.status(400).json({ error: periodo.error });
  const { desde, hasta } = periodo;

  try {
    const [totales, categorias, por_mes, movimientos, metas] = await Promise.all([
      obtenerTotales(contexto, desde, hasta),
      obtenerCategorias(contexto.familiaId, desde, hasta),
      obtenerPorMes(contexto.familiaId, desde, hasta),
      obtenerMovimientos(contexto, { desde, hasta }),
      listarMetas(contexto),
    ]);
    return res.json({
      success: true,
      periodo: { desde, hasta },
      alcance_detalle: contexto.verDetalle ? 'familia' : 'personal',
      totales,
      categorias,
      por_mes,
      movimientos,
      metas,
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar el resumen financiero');
  }
});

// RF041_ Reporte de ingresos y egresos, con filtros
router.get('/ingresos-egresos', async (req: PeticionGastos, res: Response) => {
  const contexto = req.contexto!;
  const periodo = leerPeriodo(req.query);
  if (periodo.error) return res.status(400).json({ error: periodo.error });

  const tipo = req.query.tipo;
  if (tipo && tipo !== 'ingreso' && tipo !== 'gasto') {
    return res.status(400).json({ error: 'Tipo: selecciona ingresos, gastos o todos.' });
  }
  const categoriaId = req.query.categoria_id ? leerId(req.query.categoria_id) : null;
  if (req.query.categoria_id && !categoriaId) return res.status(400).json({ error: 'Categoría: no es válida.' });
  const usuarioId = req.query.usuario_id ? leerId(req.query.usuario_id) : null;
  if (req.query.usuario_id && !usuarioId) return res.status(400).json({ error: 'Integrante: no es válido.' });
  if (usuarioId && usuarioId !== contexto.usuarioId && !contexto.verDetalle) {
    return res.status(403).json({ error: 'No tienes permiso para ver el detalle de otros integrantes.' });
  }

  try {
    const movimientos = await obtenerMovimientos(contexto, {
      desde: periodo.desde,
      hasta: periodo.hasta,
      tipo: (tipo as 'ingreso' | 'gasto' | undefined) ?? null,
      categoriaId,
      usuarioId,
    });
    const sumar = (t: string) => movimientos.filter((m) => m.tipo === t).reduce((s, m) => s + m.monto, 0);
    return res.json({
      success: true,
      periodo: { desde: periodo.desde, hasta: periodo.hasta },
      total_ingresos: sumar('ingreso'),
      total_gastos: sumar('gasto'),
      movimientos,
    });
  } catch (err: any) {
    return responderError(res, err, 'generar el reporte de ingresos y egresos');
  }
});

// RF042_ Reporte de gastos por categoría
router.get('/categorias', async (req: PeticionGastos, res: Response) => {
  const periodo = leerPeriodo(req.query);
  if (periodo.error) return res.status(400).json({ error: periodo.error });
  try {
    const categorias = await obtenerCategorias(req.contexto!.familiaId, periodo.desde, periodo.hasta);
    return res.json({
      success: true,
      periodo: { desde: periodo.desde, hasta: periodo.hasta },
      total: categorias.reduce((s, c) => s + c.total, 0),
      categorias,
    });
  } catch (err: any) {
    return responderError(res, err, 'generar el reporte por categoría');
  }
});

// RF043_ Reporte financiero familiar
router.get('/familiar', async (req: PeticionGastos, res: Response) => {
  const contexto = req.contexto!;
  const periodo = leerPeriodo(req.query);
  if (periodo.error) return res.status(400).json({ error: periodo.error });
  try {
    const [totales, por_mes] = await Promise.all([
      obtenerTotales(contexto, periodo.desde, periodo.hasta),
      obtenerPorMes(contexto.familiaId, periodo.desde, periodo.hasta),
    ]);
    return res.json({
      success: true,
      periodo: { desde: periodo.desde, hasta: periodo.hasta },
      ...totales.familia,
      por_mes,
    });
  } catch (err: any) {
    return responderError(res, err, 'generar el reporte familiar');
  }
});

export default router;
