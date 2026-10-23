import { Router, Response } from 'express';
import { pool } from '../../db';
import { PeticionGastos, cargarContexto } from '../gastos/gastos.permisos';
import { validarConfiguracion } from './configuracion.validaciones';

const router = Router();

// RNF04_ todas las rutas pasan primero por aquí para saber quién es el usuario y su familia
// (los gastos fijos se guardan por familia, por eso el cuestionario se contesta ya con familia)
router.use(cargarContexto);

// errores que manda la base de datos (triggers y checks de famify_db.sql)
const responderError = (res: Response, err: any, accion: string) => {
  console.error(`❌ Error al ${accion}:`, err.message);
  if (err.code === '42501') {
    return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
  }
  if (err.code === 'P0001') {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === '23505') {
    return res.status(400).json({ error: 'Hay datos repetidos en tu configuración (revisa los nombres de tus tarjetas).' });
  }
  if (err.code === '23514' || err.code === '23503') {
    return res.status(400).json({ error: 'Los datos no cumplen las reglas del sistema.' });
  }
  return res.status(500).json({ error: 'Ocurrió un problema en el servidor. Intenta de nuevo.' });
};

// Listas para los menús del cuestionario (RF06 métodos de pago, RF08 categorías de gastos fijos)
router.get('/catalogos', async (req: PeticionGastos, res: Response) => {
  const { familiaId } = req.contexto!;
  try {
    const [metodos, categorias] = await Promise.all([
      pool.query('SELECT id, nombre, es_credito FROM metodos_pago ORDER BY id'),
      pool.query(
        `SELECT id, nombre FROM categorias
          WHERE activa AND (familia_id IS NULL OR familia_id = $1::bigint)
          ORDER BY nombre`,
        [familiaId]
      ),
    ]);
    return res.json({ success: true, metodos_pago: metodos.rows, categorias: categorias.rows });
  } catch (err: any) {
    return responderError(res, err, 'consultar catálogos de configuración');
  }
});

// Configuración que ya tiene guardada el usuario (RF05 a RF08)
router.get('/', async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  try {
    const [usuario, metodos, gastos] = await Promise.all([
      pool.query(
        `SELECT recibe_sueldo, ingreso_principal, tiene_ingresos_secundarios, dias_ingreso, perfil_completo
           FROM usuarios WHERE id = $1::bigint`,
        [usuarioId]
      ),
      pool.query(
        `SELECT id, metodo_pago_id, alias, dia_corte, dia_limite_pago
           FROM usuario_metodos_pago WHERE usuario_id = $1::bigint AND activo ORDER BY id`,
        [usuarioId]
      ),
      pool.query(
        `SELECT id, categoria_id, descripcion, monto, dia_pago, dias_aviso
           FROM gastos_fijos
          WHERE usuario_id = $1::bigint AND familia_id = $2::bigint AND activo ORDER BY id`,
        [usuarioId, familiaId]
      ),
    ]);
    return res.json({
      success: true,
      configuracion: usuario.rows[0],
      metodos_pago: metodos.rows,
      gastos_fijos: gastos.rows,
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar la configuración');
  }
});

// RF05 a RF08: guarda todo el cuestionario y marca el perfil como completo (RF04)
// RNF15_ se hace en una sola transacción: o se guarda todo o no se guarda nada
router.post('/completar', async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;

  let catalogos;
  try {
    const [metodos, categorias] = await Promise.all([
      pool.query('SELECT id, es_credito FROM metodos_pago'),
      pool.query(
        `SELECT id FROM categorias
          WHERE activa AND (familia_id IS NULL OR familia_id = $1::bigint)`,
        [familiaId]
      ),
    ]);
    catalogos = {
      metodos: new Map<number, boolean>(metodos.rows.map((m: any) => [Number(m.id), m.es_credito === true])),
      categorias: new Set<number>(categorias.rows.map((c: any) => Number(c.id))),
    };
  } catch (err: any) {
    return responderError(res, err, 'validar el cuestionario');
  }

  const { errores, datos } = validarConfiguracion(req.body, catalogos);
  if (errores.length > 0) {
    return res.status(400).json({ error: errores.join(' '), errores });
  }

  const cliente = await pool.connect();
  let yaCompleto = false;
  try {
    await cliente.query('BEGIN');

    const actual = await cliente.query(
      'SELECT perfil_completo FROM usuarios WHERE id = $1::bigint AND activo FOR UPDATE',
      [usuarioId]
    );
    if (actual.rows[0]?.perfil_completo === true) {
      yaCompleto = true;
      await cliente.query('ROLLBACK');
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

      // RF06_ y RF07_ (RNF07_ solo se guarda alias y días, nunca el número de tarjeta)
      for (const m of datos.metodos) {
        await cliente.query(
          `INSERT INTO usuario_metodos_pago (usuario_id, metodo_pago_id, alias, dia_corte, dia_limite_pago)
           VALUES ($1::bigint, $2::smallint, $3, $4::smallint, $5::smallint)`,
          [usuarioId, m.metodo_pago_id, m.alias, m.dia_corte, m.dia_limite_pago]
        );
      }

      // RF08_
      for (const g of datos.gastosFijos) {
        await cliente.query(
          `INSERT INTO gastos_fijos (familia_id, usuario_id, categoria_id, descripcion, monto, dia_pago, dias_aviso)
           VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5::numeric, $6::smallint, $7::smallint)`,
          [familiaId, usuarioId, g.categoria_id, g.descripcion, g.monto, g.dia_pago, g.dias_aviso]
        );
      }

      await cliente.query('COMMIT');
    }
  } catch (err: any) {
    await cliente.query('ROLLBACK').catch(() => undefined);
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
