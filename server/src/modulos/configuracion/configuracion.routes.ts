import { Router, type Response } from 'express';
import { enTransaccion, pool } from '../../db';
import { METODOS_PAGO, metodoPorCodigo, metodoPorId } from '../../catalogos';
import { ErrorNegocio, responderError } from '../compartido/errores';
import { type PeticionGastos, cargarContexto } from '../gastos/gastos.permisos';
import { validarConfiguracion } from './configuracion.validaciones';

const router = Router();

router.use(cargarContexto);

const SQL_CATEGORIAS = `
  SELECT id, nombre FROM categoria_de_los_gastos
   WHERE activa AND (familia_id IS NULL OR familia_id = $1::bigint)
   ORDER BY nombre`;

// RF06_ / RF08_ Listas para el menú de métodos de pago y las categorías de gastos fijos
// Los métodos de pago son valores fijos de la base de datos (ver catalogos.ts)
router.get('/catalogos', async (req: PeticionGastos, res: Response) => {
  try {
    const categorias = await pool.query(SQL_CATEGORIAS, [req.contexto!.familiaId]);
    return res.json({
      success: true,
      metodos_pago: METODOS_PAGO.map(({ id, nombre, es_credito }) => ({ id, nombre, es_credito })),
      categorias: categorias.rows.map((c: any) => ({ id: Number(c.id), nombre: c.nombre })),
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar catálogos de configuración');
  }
});

// Devuelve la configuración guardada para poder editarla (todo vive en configuracion_financiera)
router.get('/', async (req: PeticionGastos, res: Response) => {
  const { usuarioId } = req.contexto!;
  try {
    const r = await pool.query(
      `SELECT u.recibe_sueldo, u.perfil_completo,
              cf.ingreso_principal, cf.ingresos_secundarios, cf.dias_de_ingreso,
              cf.metodos_de_pago, cf.dia_de_corte,
              EXTRACT(day FROM cf.fecha_limite_de_pago)::int AS dia_limite_pago,
              cf.gastos_fijos
         FROM usuario u
         LEFT JOIN configuracion_financiera cf ON cf.usuario_id = u.id
        WHERE u.id = $1::bigint`,
      [usuarioId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const f = r.rows[0];
    const metodos = ((f.metodos_de_pago ?? []) as string[])
      .map((codigo) => metodoPorCodigo(codigo))
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .map((m) => ({
        metodo_pago_id: m.id,
        nombre: m.nombre,
        alias: m.es_credito ? 'Principal' : null,
        dia_corte: m.es_credito ? f.dia_de_corte : null,
        dia_limite_pago: m.es_credito ? f.dia_limite_pago : null,
      }));

    return res.json({
      success: true,
      configuracion: {
        recibe_sueldo: f.recibe_sueldo,
        ingreso_principal: f.ingreso_principal,
        tiene_ingresos_secundarios: f.ingresos_secundarios !== null && f.ingresos_secundarios !== undefined,
        dias_ingreso: f.dias_de_ingreso,
        perfil_completo: f.perfil_completo,
      },
      metodos_pago: metodos,
      gastos_fijos: Array.isArray(f.gastos_fijos) ? f.gastos_fijos : [],
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar la configuración');
  }
});

// RF05_ a RF08_ Guarda toda la configuración en una transacción (RNF15).
// Al completar el registro solo se admite una vez; después se usa la edición.
const guardarConfiguracion = async (req: PeticionGastos, res: Response, soloPrimeraVez: boolean) => {
  const { usuarioId, familiaId } = req.contexto!;

  let catalogos;
  try {
    const categorias = await pool.query(SQL_CATEGORIAS, [familiaId]);
    catalogos = {
      metodos: new Map<number, { nombre: string; es_credito: boolean }>(
        METODOS_PAGO.map((m) => [m.id, { nombre: m.nombre, es_credito: m.es_credito }])
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

  // La base guarda los métodos como texto y una sola tarjeta de crédito (día de corte y límite de pago)
  const codigos = datos.metodos.map((m) => metodoPorId(m.metodo_pago_id)!.codigo);
  const credito = datos.metodos.find((m) => metodoPorId(m.metodo_pago_id)?.es_credito);

  try {
    await enTransaccion(async (cliente) => {
      const actual = await cliente.query('SELECT perfil_completo FROM usuario WHERE id = $1::bigint AND activo FOR UPDATE', [
        usuarioId,
      ]);
      if (actual.rows.length === 0) throw new ErrorNegocio(404, 'Usuario no encontrado o inactivo.');
      if (soloPrimeraVez && actual.rows[0].perfil_completo === true) {
        throw new ErrorNegocio(409, 'Tu perfil ya estaba completo.');
      }

      // RF05_ el permiso de registrar ingresos depende de recibe_sueldo (fn_tiene_permiso)
      await cliente.query('UPDATE usuario SET recibe_sueldo = $2::boolean WHERE id = $1::bigint', [
        usuarioId,
        datos.recibe_sueldo,
      ]);

      // RF05 a RF08_ Todo el perfil financiero va en una sola fila. fecha_limite_de_pago es una fecha:
      // se guarda la próxima fecha que cae en ese día del mes. RNF07_ nunca se guarda el número de tarjeta.
      // La primera vez, el trigger trg_perfil_completo marca usuario.perfil_completo = true (RF04).
      await cliente.query(
        `INSERT INTO configuracion_financiera
                (usuario_id, ingreso_principal, ingresos_secundarios, dias_de_ingreso,
                 metodos_de_pago, dia_de_corte, fecha_limite_de_pago, gastos_fijos)
         VALUES ($1::bigint, $2::numeric, $3::text, $4::smallint[],
                 $5::text[], $6::smallint,
                 CASE WHEN $7::int IS NULL THEN NULL ELSE fn_proxima_fecha($7::int) END,
                 $8::jsonb)
         ON CONFLICT (usuario_id) DO UPDATE
            SET ingreso_principal = EXCLUDED.ingreso_principal,
                ingresos_secundarios = EXCLUDED.ingresos_secundarios,
                dias_de_ingreso = EXCLUDED.dias_de_ingreso,
                metodos_de_pago = EXCLUDED.metodos_de_pago,
                dia_de_corte = EXCLUDED.dia_de_corte,
                fecha_limite_de_pago = EXCLUDED.fecha_limite_de_pago,
                gastos_fijos = EXCLUDED.gastos_fijos`,
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
    });
  } catch (err: any) {
    return responderError(res, err, 'guardar la configuración del usuario');
  }

  return res.status(soloPrimeraVez ? 201 : 200).json({
    success: true,
    message: soloPrimeraVez ? 'Configuración guardada. ¡Tu perfil quedó completo!' : 'Configuración actualizada.',
    perfil_completo: true,
    recibe_sueldo: datos.recibe_sueldo,
  });
};

router.post('/completar', (req: PeticionGastos, res: Response) => guardarConfiguracion(req, res, true));

// RF034_ Los recordatorios, tarjetas y gastos fijos se pueden cambiar después del registro
router.put('/', (req: PeticionGastos, res: Response) => guardarConfiguracion(req, res, false));

export default router;
