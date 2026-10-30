import { Router, type Response } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../../db';
import { type PeticionGastos, cargarContexto } from '../gastos/gastos.permisos';
import { validarConfiguracion } from './configuracion.validaciones';

const router = Router();

router.use(cargarContexto);

const responderError = (res: Response, err: any, accion: string) => {
  console.error(`Error al ${accion}:`, err.message);
  if (err.code === '42501') {
    return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
  }
  if (err.code === 'P0001') {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === '23505') {
    return res.status(400).json({ error: 'Hay datos repetidos en tu configuración.' });
  }
  if (err.code === '23514' || err.code === '23503') {
    return res.status(400).json({ error: 'Los datos no cumplen las reglas del sistema.' });
  }
  return res.status(500).json({ error: 'Ocurrió un problema en el servidor. Intenta de nuevo.' });
};

router.get('/catalogos', async (req: PeticionGastos, res: Response) => {
  const { familiaId } = req.contexto!;
  try {
    const [categorias, metodos] = await Promise.all([
      pool.query(
        `SELECT id, nombre FROM categorias
          WHERE activa AND (familia_id IS NULL OR familia_id = $1::bigint)
          ORDER BY nombre`,
        [familiaId]
      ),
      pool.query('SELECT id, nombre, es_credito FROM metodos_pago ORDER BY id'),
    ]);
    return res.json({ success: true, metodos_pago: metodos.rows, categorias: categorias.rows });
  } catch (err: any) {
    return responderError(res, err, 'consultar catálogos de configuración');
  }
});

router.get('/', async (req: PeticionGastos, res: Response) => {
  const { usuarioId } = req.contexto!;
  try {
    const [usuario, metodos, gastos] = await Promise.all([
      pool.query(
        `SELECT recibe_sueldo, perfil_completo, ingreso_principal,
                tiene_ingresos_secundarios, dias_ingreso
           FROM usuarios WHERE id = $1::bigint`,
        [usuarioId]
      ),
      pool.query(
        `SELECT ump.id, ump.metodo_pago_id, ump.alias, ump.dia_corte,
                ump.dia_limite_pago, mp.nombre
           FROM usuario_metodos_pago ump
           JOIN metodos_pago mp ON mp.id = ump.metodo_pago_id
          WHERE ump.usuario_id = $1::bigint AND ump.activo
          ORDER BY ump.id`,
        [usuarioId]
      ),
      pool.query(
        `SELECT gf.id, gf.categoria_id, gf.descripcion, gf.monto,
                gf.dia_pago, gf.dias_aviso
           FROM gastos_fijos gf
          WHERE gf.usuario_id = $1::bigint AND gf.familia_id = $2::bigint AND gf.activo
          ORDER BY gf.id`,
        [usuarioId, req.contexto!.familiaId]
      ),
    ]);

    if (usuario.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const f = usuario.rows[0];
    return res.json({
      success: true,
      configuracion: {
        recibe_sueldo: f.recibe_sueldo,
        ingreso_principal: f.ingreso_principal,
        tiene_ingresos_secundarios: f.tiene_ingresos_secundarios,
        dias_ingreso: f.dias_ingreso,
        perfil_completo: f.perfil_completo,
      },
      metodos_pago: metodos.rows,
      gastos_fijos: gastos.rows,
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar la configuración');
  }
});

router.post('/completar', async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;

  let catalogos;
  try {
    const [categorias, metodos] = await Promise.all([
      pool.query(
        `SELECT id FROM categorias
          WHERE activa AND (familia_id IS NULL OR familia_id = $1::bigint)`,
        [familiaId]
      ),
      pool.query('SELECT id, nombre, es_credito FROM metodos_pago'),
    ]);
    catalogos = {
      metodos: new Map<number, { nombre: string; es_credito: boolean }>(
        metodos.rows.map((m: any) => [Number(m.id), { nombre: m.nombre, es_credito: m.es_credito }])
      ),
      categorias: new Set<number>(categorias.rows.map((c: any) => Number(c.id))),
    };
  } catch (err: any) {
    return responderError(res, err, 'validar el cuestionario');
  }

  const { errores, datos } = validarConfiguracion(req.body, catalogos);
  if (errores.length > 0) {
    return res.status(400).json({ error: errores.join(' '), errores });
  }

  let cliente: PoolClient;
  try {
    cliente = await pool.connect();
  } catch (err: any) {
    return responderError(res, err, 'conectar para guardar la configuración');
  }

  let transaccionIniciada = false;
  let yaCompleto = false;
  try {
    await cliente.query('BEGIN');
    transaccionIniciada = true;

    const actual = await cliente.query(
      'SELECT perfil_completo FROM usuarios WHERE id = $1::bigint AND activo FOR UPDATE',
      [usuarioId]
    );
    if (actual.rows.length === 0) {
      await cliente.query('ROLLBACK');
      transaccionIniciada = false;
      return res.status(404).json({ error: 'Usuario no encontrado o inactivo.' });
    }
    if (actual.rows[0].perfil_completo === true) {
      yaCompleto = true;
      await cliente.query('ROLLBACK');
      transaccionIniciada = false;
    } else {
      await cliente.query(
        `UPDATE usuarios
            SET recibe_sueldo = $2::boolean,
                ingreso_principal = $3::numeric,
                tiene_ingresos_secundarios = $4::boolean,
                dias_ingreso = $5::smallint[],
                perfil_completo = true
          WHERE id = $1::bigint`,
        [
          usuarioId,
          datos.recibe_sueldo,
          datos.ingreso_principal,
          datos.tiene_ingresos_secundarios,
          datos.dias_ingreso,
        ]
      );

      await cliente.query('DELETE FROM usuario_metodos_pago WHERE usuario_id = $1::bigint', [usuarioId]);
      for (const metodo of datos.metodos) {
        await cliente.query(
          `INSERT INTO usuario_metodos_pago
                  (usuario_id, metodo_pago_id, alias, dia_corte, dia_limite_pago)
           VALUES ($1::bigint, $2::smallint, $3::varchar, $4::smallint, $5::smallint)`,
          [usuarioId, metodo.metodo_pago_id, metodo.alias, metodo.dia_corte, metodo.dia_limite_pago]
        );
      }

      await cliente.query(
        `DELETE FROM gastos_fijos
          WHERE usuario_id = $1::bigint AND familia_id = $2::bigint`,
        [usuarioId, familiaId]
      );
      for (const gasto of datos.gastosFijos) {
        await cliente.query(
          `INSERT INTO gastos_fijos
                  (familia_id, usuario_id, categoria_id, descripcion, monto, dia_pago, dias_aviso)
           VALUES ($1::bigint, $2::bigint, $3::bigint, $4::varchar,
                   $5::numeric, $6::smallint, $7::smallint)`,
          [
            familiaId,
            usuarioId,
            gasto.categoria_id,
            gasto.descripcion,
            gasto.monto,
            gasto.dia_pago,
            gasto.dias_aviso,
          ]
        );
      }

      await cliente.query('COMMIT');
      transaccionIniciada = false;
    }
  } catch (err: any) {
    if (transaccionIniciada) {
      try {
        await cliente.query('ROLLBACK');
      } catch (rollbackError: any) {
        console.error('Error al revertir la configuración:', rollbackError.message);
      }
    }
    return responderError(res, err, 'guardar la configuración del usuario');
  } finally {
    cliente.release();
  }

  if (yaCompleto) {
    return res.status(409).json({ error: 'Tu perfil ya estaba completo.' });
  }
  return res.status(201).json({
    success: true,
    message: 'Configuración guardada. ¡Tu perfil quedó completo!',
    perfil_completo: true,
    recibe_sueldo: datos.recibe_sueldo,
  });
});

export default router;
