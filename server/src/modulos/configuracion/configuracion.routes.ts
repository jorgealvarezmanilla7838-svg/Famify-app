import express, { Response } from 'express';
import { pool } from '../../db';
import { PeticionGastos } from '../gastos/gastos.permisos';
import { validarConfiguracion, type CatalogosValidacion } from './configuracion.validaciones';
import { METODOS_PAGO, metodoPorId } from '../../catalogos';

const router = express.Router();

// El cuestionario es del usuario (no necesita familia): se usa el id que viene en el token ya verificado
const SQL_CATEGORIAS = `
  SELECT id, nombre FROM categoria_de_los_gastos
   WHERE activa AND (familia_id IS NULL
                     OR familia_id = (SELECT familia_id FROM usuario WHERE id = $1::bigint))
   ORDER BY nombre`;

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
    return res.status(400).json({ error: 'Tu configuración ya estaba guardada.' });
  }
  if (err.code === '23514' || err.code === '23503') {
    return res.status(400).json({ error: 'Los datos no cumplen las reglas del sistema.' });
  }
  return res.status(500).json({ error: 'Ocurrió un problema en el servidor. Intenta de nuevo.' });
};

// Listas para el menú del cuestionario (RF06 métodos de pago y RF08 categorías)
router.get('/catalogos', async (req: PeticionGastos, res: Response) => {
  try {
    const categorias = await pool.query(SQL_CATEGORIAS, [req.user?.id]);
    return res.json({
      success: true,
      metodos_pago: METODOS_PAGO.map(({ id, nombre, es_credito }) => ({ id, nombre, es_credito })),
      categorias: categorias.rows.map((c) => ({ id: Number(c.id), nombre: c.nombre })),
    });
  } catch (err: any) {
    return responderError(res, err, 'cargar los catálogos del cuestionario');
  }
});

// Configuración que ya tiene guardada el usuario (RF05 a RF08)
router.get('/', async (req: PeticionGastos, res: Response) => {
  try {
    const r = await pool.query(
      `SELECT u.recibe_sueldo, u.perfil_completo,
              c.ingreso_principal,
              (c.ingresos_secundarios IS NOT NULL) AS tiene_ingresos_secundarios,
              c.dias_de_ingreso AS dias_ingreso,
              COALESCE(c.metodos_de_pago, '{}') AS metodos_de_pago,
              c.dia_de_corte,
              EXTRACT(day FROM c.fecha_limite_de_pago)::int AS dia_limite_pago,
              COALESCE(c.gastos_fijos, '[]'::jsonb) AS gastos_fijos
         FROM usuario u
         LEFT JOIN configuracion_financiera c ON c.usuario_id = u.id
        WHERE u.id = $1::bigint`,
      [req.user?.id]
    );
    return res.json({ success: true, configuracion: r.rows[0] || null });
  } catch (err: any) {
    return responderError(res, err, 'consultar la configuración');
  }
});

// RF05 a RF08: guarda todo el cuestionario y marca el perfil como completo (RF04)
// RNF15_ todo en una sola transacción: o se guarda todo o no se guarda nada
router.post('/completar', async (req: PeticionGastos, res: Response) => {
  const usuarioId = Number(req.user?.id);

  let catalogos: CatalogosValidacion;
  try {
    const categorias = await pool.query(SQL_CATEGORIAS, [usuarioId]);
    catalogos = {
      metodos: new Map(METODOS_PAGO.map((m) => [m.id, { nombre: m.nombre, es_credito: m.es_credito }])),
      categorias: new Set<number>(categorias.rows.map((c) => Number(c.id))),
    };
  } catch (err: any) {
    return responderError(res, err, 'validar el cuestionario');
  }

  const { errores, datos } = validarConfiguracion(req.body, catalogos);
  if (errores.length > 0) {
    return res.status(400).json({ error: errores.join(' '), errores });
  }

  // La base de datos guarda los métodos como texto (efectivo, tarjeta_credito...) y una sola tarjeta de crédito
  const codigos = datos.metodos.map((m) => metodoPorId(m.metodo_pago_id)!.codigo);
  const credito = datos.metodos.find((m) => metodoPorId(m.metodo_pago_id)?.es_credito);

  const cliente = await pool.connect();
  let yaCompleto = false;
  try {
    await cliente.query('BEGIN');

    const actual = await cliente.query(
      'SELECT perfil_completo FROM usuario WHERE id = $1::bigint AND activo FOR UPDATE',
      [usuarioId]
    );
    if (actual.rows.length === 0) {
      await cliente.query('ROLLBACK');
      return res.status(403).json({ error: 'Usuario no válido.' });
    }
    if (actual.rows[0].perfil_completo === true) {
      yaCompleto = true;
      await cliente.query('ROLLBACK');
    } else {
      // RF05_ el permiso de registrar ingresos depende de recibe_sueldo (fn_tiene_permiso)
      await cliente.query('UPDATE usuario SET recibe_sueldo = $2::boolean WHERE id = $1::bigint', [
        usuarioId,
        datos.recibe_sueldo,
      ]);

      // RF05 a RF08_ todo el perfil financiero va en una sola fila (RNF07_ nunca se guarda número de tarjeta)
      // fecha_limite_de_pago es una fecha: se guarda la próxima fecha con ese día del mes
      // el trigger trg_perfil_completo marca usuario.perfil_completo = true al insertar (RF04)
      await cliente.query(
        `INSERT INTO configuracion_financiera
           (usuario_id, ingreso_principal, ingresos_secundarios, dias_de_ingreso,
            metodos_de_pago, dia_de_corte, fecha_limite_de_pago, gastos_fijos)
         VALUES ($1::bigint, $2::numeric, $3::text, $4::smallint[],
                 $5::text[], $6::smallint,
                 CASE WHEN $7::int IS NULL THEN NULL ELSE fn_proxima_fecha($7::int) END,
                 $8::jsonb)`,
        [
          usuarioId,
          datos.ingreso_principal,
          datos.tiene_ingresos_secundarios ? 'Sí' : null,
          datos.dias_ingreso,
          codigos,
          credito ? credito.dia_corte : null,
          credito ? credito.dia_limite_pago : null,
          JSON.stringify(datos.gastosFijos),
        ]
      );

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
