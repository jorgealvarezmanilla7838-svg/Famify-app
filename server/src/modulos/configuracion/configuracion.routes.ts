import { Router, Response } from 'express';
import { pool } from '../../db';
import { PeticionGastos, cargarContexto } from '../gastos/gastos.permisos';
import { validarConfiguracion } from './configuracion.validaciones';
import { METODOS_PAGO, metodoPorCodigo } from '../../catalogos';

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
    return res.status(400).json({ error: 'Hay datos repetidos en tu configuración (ya existe una configuración guardada para tu usuario).' });
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
    const categorias = await pool.query(
      `SELECT id, nombre FROM categoria_de_los_gastos
        WHERE activa AND (familia_id IS NULL OR familia_id = $1::bigint)
        ORDER BY nombre`,
      [familiaId]
    );
    const metodos = METODOS_PAGO.map(({ id, nombre, es_credito }) => ({ id, nombre, es_credito }));
    return res.json({ success: true, metodos_pago: metodos, categorias: categorias.rows });
  } catch (err: any) {
    return responderError(res, err, 'consultar catálogos de configuración');
  }
});

// Configuración que ya tiene guardada el usuario (RF05 a RF08)
// Ahora todo vive en usuario + configuracion_financiera (una fila por usuario);
// aquí se arma la misma respuesta de antes para que el cliente no cambie.
router.get('/', async (req: PeticionGastos, res: Response) => {
  const { usuarioId } = req.contexto!;
  try {
    const r = await pool.query(
      `SELECT u.recibe_sueldo, u.perfil_completo,
              c.ingreso_principal,
              (c.ingresos_secundarios IS NOT NULL) AS tiene_ingresos_secundarios,
              c.dias_de_ingreso AS dias_ingreso,
              c.metodos_de_pago, c.dia_de_corte,
              EXTRACT(day FROM c.fecha_limite_de_pago)::int AS dia_limite_pago,
              c.gastos_fijos
         FROM usuario u
         LEFT JOIN configuracion_financiera c ON c.usuario_id = u.id
        WHERE u.id = $1::bigint`,
      [usuarioId]
    );
    const f = r.rows[0] ?? {};

    const metodos = ((f.metodos_de_pago as string[] | null) ?? []).map((codigo) => {
      const m = metodoPorCodigo(codigo);
      return {
        id: m?.id ?? null,
        metodo_pago_id: m?.id ?? null,
        alias: 'Principal',
        dia_corte: m?.es_credito ? f.dia_de_corte : null,
        dia_limite_pago: m?.es_credito ? f.dia_limite_pago : null,
      };
    });

    const gastos = ((f.gastos_fijos as any[] | null) ?? []).map((g, i) => ({
      id: i + 1,
      categoria_id: g.categoria_id ?? null,
      descripcion: g.descripcion,
      monto: g.monto,
      dia_pago: g.dia_pago,
      dias_aviso: g.dias_aviso,
    }));

    return res.json({
      success: true,
      configuracion: {
        recibe_sueldo: f.recibe_sueldo,
        ingreso_principal: f.ingreso_principal ?? null,
        tiene_ingresos_secundarios: f.tiene_ingresos_secundarios ?? false,
        dias_ingreso: f.dias_ingreso ?? null,
        perfil_completo: f.perfil_completo,
      },
      metodos_pago: metodos,
      gastos_fijos: gastos,
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
    const categorias = await pool.query(
      `SELECT id FROM categoria_de_los_gastos
        WHERE activa AND (familia_id IS NULL OR familia_id = $1::bigint)`,
      [familiaId]
    );
    catalogos = {
      metodos: new Map<number, boolean>(METODOS_PAGO.map((m) => [m.id, m.es_credito])),
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
      'SELECT perfil_completo FROM usuario WHERE id = $1::bigint AND activo FOR UPDATE',
      [usuarioId]
    );
    if (actual.rows[0]?.perfil_completo === true) {
      yaCompleto = true;
      await cliente.query('ROLLBACK');
    } else {
      // RF05_ si recibe sueldo o no (de esto dependen los permisos de ingresos)
      await cliente.query(
        `UPDATE usuario SET recibe_sueldo = $2::boolean, perfil_completo = true WHERE id = $1::bigint`,
        [usuarioId, datos.recibe_sueldo]
      );

      // RF05 a RF08_ una sola fila por usuario en configuracion_financiera
      // RNF07_ no hay columnas para número de tarjeta ni CVV: solo métodos, corte y límite
      // el límite de pago se guarda como fecha (la próxima ocurrencia de ese día del mes)
      const credito = datos.metodos.find((m) => m.dia_corte !== null);
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
          datos.metodos.map((m) => m.codigo),
          credito?.dia_corte ?? null,
          credito?.dia_limite_pago ?? null,
          // RF08_ gastos fijos: [{descripcion, categoria_id, monto, dia_pago, dias_aviso}]
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
