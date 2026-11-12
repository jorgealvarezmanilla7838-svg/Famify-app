import { Router, type Response } from 'express';
import type { PoolClient } from 'pg';
import { enTransaccion, pool } from '../../db';
import { ErrorNegocio, montoValido, responderError, textoRecortado } from '../compartido/errores';
import { type PeticionGastos, cargarContexto, exigirPermiso } from '../gastos/gastos.permisos';
import { esFechaValida, leerId } from '../gastos/gastos.validaciones';
import { listarPresupuestos } from './presupuesto.servicio';

const router = Router();
router.use(cargarContexto);

const validarPresupuesto = (body: any) => {
  const errores: string[] = [];
  const nombre = textoRecortado(body?.nombre);
  if (!nombre || nombre.length > 100) errores.push('Nombre: es obligatorio y admite hasta 100 caracteres.');
  if (!montoValido(body?.monto_total)) errores.push('Monto total: escribe un número mayor a 0, con máximo 2 decimales.');
  if (!esFechaValida(body?.desde)) errores.push('Desde: selecciona una fecha válida.');
  if (!esFechaValida(body?.hasta)) errores.push('Hasta: selecciona una fecha válida.');
  if (esFechaValida(body?.desde) && esFechaValida(body?.hasta) && body.desde > body.hasta) {
    errores.push('Hasta: debe ser igual o posterior a la fecha Desde.');
  }

  const categorias: { categoria_id: number; monto: number }[] = [];
  for (const fila of Array.isArray(body?.categorias) ? body.categorias : []) {
    const categoriaId = leerId(fila?.categoria_id);
    if (!categoriaId) {
      errores.push('Categoría: selecciona una categoría válida en cada fila.');
    } else if (!montoValido(fila?.monto)) {
      errores.push('Monto por categoría: escribe un número mayor a 0.');
    } else if (categorias.some((c) => c.categoria_id === categoriaId)) {
      errores.push('Categoría: cada categoría solo puede asignarse una vez.');
    } else {
      categorias.push({ categoria_id: categoriaId, monto: Number(fila.monto) });
    }
  }
  const asignado = categorias.reduce((suma, c) => suma + c.monto, 0);
  if (montoValido(body?.monto_total) && asignado > Number(body.monto_total)) {
    errores.push('Monto por categoría: la suma de las categorías no puede superar el monto total.');
  }

  return {
    errores,
    datos: { nombre, monto_total: Number(body?.monto_total), desde: body?.desde, hasta: body?.hasta, categorias },
  };
};

const guardarCategorias = async (
  cliente: PoolClient,
  presupuestoId: number,
  familiaId: number,
  categorias: { categoria_id: number; monto: number }[]
) => {
  // RNF04_ solo categorías generales o de la propia familia (el trigger de la base también lo valida)
  // El trigger tg_presupuesto_cat revisa que la suma por categoría no supere el total
  for (const categoria of categorias) {
    const insertada = await cliente.query(
      `INSERT INTO presupuesto_por_categoria (presupuesto_id, categoria_id, monto_asignado)
       SELECT $1::bigint, c.id, $3::numeric FROM categoria_de_los_gastos c
        WHERE c.id = $2::bigint AND c.activa AND (c.familia_id IS NULL OR c.familia_id = $4::bigint)`,
      [presupuestoId, categoria.categoria_id, categoria.monto, familiaId]
    );
    if (insertada.rowCount === 0) throw new ErrorNegocio(400, 'Categoría: una de las categorías no está disponible.');
  }
};

// RF021_ Consulta del presupuesto disponible. RF022_ incluye el estado de alerta.
router.get('/', async (req: PeticionGastos, res: Response) => {
  try {
    return res.json({ success: true, presupuestos: await listarPresupuestos(req.contexto!.familiaId) });
  } catch (err: any) {
    return responderError(res, err, 'consultar los presupuestos');
  }
});

// RF019_ Creación de presupuesto. RF020_ Asignación por categoría.
router.post('/', exigirPermiso('presupuesto.gestionar'), async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  const { errores, datos } = validarPresupuesto(req.body);
  if (errores.length > 0) return res.status(400).json({ error: errores.join(' '), errores });

  try {
    const id = await enTransaccion(async (cliente) => {
      // Una familia no puede tener dos presupuestos con fechas traslapadas (restricción de la base de datos)
      const creado = await cliente.query(
        `INSERT INTO presupuesto (familia_id, periodo, monto_total, fecha_inicio, fecha_fin, creado_por)
         VALUES ($1::bigint, $2::varchar, $3::numeric, $4::date, $5::date, $6::bigint) RETURNING id`,
        [familiaId, datos.nombre, datos.monto_total, datos.desde, datos.hasta, usuarioId]
      );
      const nuevoId = Number(creado.rows[0].id);
      await guardarCategorias(cliente, nuevoId, familiaId, datos.categorias);
      return nuevoId;
    });
    return res.status(201).json({ success: true, message: 'Presupuesto creado.', id });
  } catch (err: any) {
    return responderError(res, err, 'crear el presupuesto');
  }
});

router.put('/:id', exigirPermiso('presupuesto.gestionar'), async (req: PeticionGastos, res: Response) => {
  const { familiaId } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'El presupuesto indicado no es válido.' });
  const { errores, datos } = validarPresupuesto(req.body);
  if (errores.length > 0) return res.status(400).json({ error: errores.join(' '), errores });

  try {
    await enTransaccion(async (cliente) => {
      // Primero se quitan las categorías anteriores: así el trigger que compara el total con la suma
      // por categoría no se confunde si el nuevo total es menor al anterior
      const existe = await cliente.query('SELECT 1 FROM presupuesto WHERE id = $1::bigint AND familia_id = $2::bigint FOR UPDATE', [
        id,
        familiaId,
      ]);
      if (existe.rows.length === 0) throw new ErrorNegocio(404, 'Presupuesto no encontrado.');
      await cliente.query('DELETE FROM presupuesto_por_categoria WHERE presupuesto_id = $1::bigint', [id]);
      await cliente.query(
        `UPDATE presupuesto SET periodo = $3::varchar, monto_total = $4::numeric,
                fecha_inicio = $5::date, fecha_fin = $6::date
          WHERE id = $1::bigint AND familia_id = $2::bigint`,
        [id, familiaId, datos.nombre, datos.monto_total, datos.desde, datos.hasta]
      );
      await guardarCategorias(cliente, id, familiaId, datos.categorias);
    });
    return res.json({ success: true, message: 'Presupuesto actualizado.' });
  } catch (err: any) {
    return responderError(res, err, 'actualizar el presupuesto');
  }
});

router.delete('/:id', exigirPermiso('presupuesto.gestionar'), async (req: PeticionGastos, res: Response) => {
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'El presupuesto indicado no es válido.' });
  try {
    const borrado = await pool.query('DELETE FROM presupuesto WHERE id = $1::bigint AND familia_id = $2::bigint', [
      id,
      req.contexto!.familiaId,
    ]);
    if (borrado.rowCount === 0) return res.status(404).json({ error: 'Presupuesto no encontrado.' });
    return res.json({ success: true, message: 'Presupuesto eliminado.' });
  } catch (err: any) {
    return responderError(res, err, 'eliminar el presupuesto');
  }
});

export default router;
