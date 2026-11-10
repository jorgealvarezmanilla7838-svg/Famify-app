import { Router, type NextFunction, type Response } from 'express';
import type { PoolClient } from 'pg';
import { enTransaccion, pool } from '../../db';
import { ErrorNegocio, responderError, textoRecortado } from '../compartido/errores';
import { type PeticionGastos, cargarContexto } from '../gastos/gastos.permisos';
import { leerId } from '../gastos/gastos.validaciones';

const ROL_ADMIN = 1;
const ROL_INTEGRANTE = 2;

const router = Router();
router.use(cargarContexto);

const soloAdmin = (req: PeticionGastos, res: Response, next: NextFunction) => {
  if (!req.contexto!.esAdmin) {
    return res.status(403).json({ error: 'Solo el administrador puede realizar esta acción.' });
  }
  return next();
};

// Bloquea a la familia para que dos cambios simultáneos no la dejen sin administrador
const integrantesBloqueados = async (cliente: PoolClient, familiaId: number) => {
  const filas = await cliente.query(
    'SELECT id, rol_id FROM usuarios WHERE familia_id = $1::bigint AND activo ORDER BY id FOR UPDATE',
    [familiaId]
  );
  return filas.rows.map((f: any) => ({ id: Number(f.id), rol_id: Number(f.rol_id) }));
};

// RNF32_ Borra los datos personales. Los gastos quedan a nombre de "Usuario eliminado"
// para no alterar la contabilidad histórica de la familia.
const anonimizarUsuario = async (cliente: PoolClient, usuarioId: number) => {
  await cliente.query('DELETE FROM ingresos WHERE usuario_id = $1::varchar', [String(usuarioId)]);
  await cliente.query('DELETE FROM usuario_metodos_pago WHERE usuario_id = $1::bigint', [usuarioId]);
  await cliente.query('DELETE FROM gastos_fijos WHERE usuario_id = $1::bigint', [usuarioId]);
  await cliente.query('DELETE FROM metas_ahorro WHERE usuario_id = $1::bigint', [usuarioId]);
  await cliente.query('DELETE FROM notificaciones WHERE usuario_id = $1::bigint', [usuarioId]);
  await cliente.query('DELETE FROM sesiones WHERE usuario_id = $1::bigint', [usuarioId]);
  await cliente.query('UPDATE invitaciones SET email_invitado = NULL WHERE usada_por = $1::bigint', [usuarioId]);
  await cliente.query(
    `UPDATE usuarios
        SET nombre = 'Usuario eliminado', email = 'eliminado-' || id || '@famify.invalid',
            password_hash = '!', activo = false, familia_id = NULL, rol_id = NULL,
            recibe_sueldo = NULL, ingreso_principal = NULL, tiene_ingresos_secundarios = false,
            dias_ingreso = NULL, perfil_completo = false
      WHERE id = $1::bigint`,
    [usuarioId]
  );
};

// RF037_ Consulta de integrantes: esta lista con correos es solo del administrador
router.get('/integrantes', soloAdmin, async (req: PeticionGastos, res: Response) => {
  try {
    const [familia, integrantes] = await Promise.all([
      pool.query('SELECT nombre FROM familias WHERE id = $1::bigint', [req.contexto!.familiaId]),
      pool.query(
        `SELECT u.id, u.nombre, u.email, u.rol_id, r.nombre AS rol,
                to_char(u.created_at, 'YYYY-MM-DD') AS desde
           FROM usuarios u JOIN roles r ON r.id = u.rol_id
          WHERE u.familia_id = $1::bigint AND u.activo
          ORDER BY u.rol_id, u.nombre`,
        [req.contexto!.familiaId]
      ),
    ]);
    return res.json({
      success: true,
      familia: familia.rows[0]?.nombre ?? '',
      integrantes: integrantes.rows.map((i: any) => ({
        ...i,
        id: Number(i.id),
        es_yo: Number(i.id) === req.contexto!.usuarioId,
      })),
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar los integrantes');
  }
});

// Lista corta, sin correos, que puede consultar cualquier integrante de la familia
router.get('/integrantes/nombres', async (req: PeticionGastos, res: Response) => {
  try {
    const [familia, filas] = await Promise.all([
      pool.query('SELECT nombre FROM familias WHERE id = $1::bigint', [req.contexto!.familiaId]),
      pool.query(
        `SELECT u.id, u.nombre, r.nombre AS rol
           FROM usuarios u JOIN roles r ON r.id = u.rol_id
          WHERE u.familia_id = $1::bigint AND u.activo
          ORDER BY u.nombre`,
        [req.contexto!.familiaId]
      ),
    ]);
    return res.json({
      success: true,
      familia: familia.rows[0]?.nombre ?? '',
      integrantes: filas.rows.map((i: any) => ({ id: Number(i.id), nombre: i.nombre, rol: i.rol })),
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar los integrantes');
  }
});

// RF038_ Asignación y modificación de roles
router.put('/integrantes/:id/rol', soloAdmin, async (req: PeticionGastos, res: Response) => {
  const { familiaId } = req.contexto!;
  const id = leerId(req.params.id);
  const rolId = Number(req.body?.rol_id);
  if (!id) return res.status(400).json({ error: 'El integrante indicado no es válido.' });
  if (rolId !== ROL_ADMIN && rolId !== ROL_INTEGRANTE) {
    return res.status(400).json({ error: 'Rol: selecciona administrador o integrante.' });
  }

  try {
    await enTransaccion(async (cliente) => {
      const integrantes = await integrantesBloqueados(cliente, familiaId);
      const objetivo = integrantes.find((i) => i.id === id);
      if (!objetivo) throw new ErrorNegocio(404, 'El integrante no pertenece a tu familia.');
      const admins = integrantes.filter((i) => i.rol_id === ROL_ADMIN).length;
      if (objetivo.rol_id === ROL_ADMIN && rolId !== ROL_ADMIN && admins === 1) {
        throw new ErrorNegocio(400, 'La familia debe conservar al menos un administrador.');
      }
      await cliente.query('UPDATE usuarios SET rol_id = $2::smallint WHERE id = $1::bigint', [id, rolId]);
    });
    return res.json({ success: true, message: 'Rol actualizado.' });
  } catch (err: any) {
    return responderError(res, err, 'cambiar el rol');
  }
});

// RF040_ Eliminación de integrantes
router.delete('/integrantes/:id', soloAdmin, async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  const id = leerId(req.params.id);
  if (!id) return res.status(400).json({ error: 'El integrante indicado no es válido.' });
  if (id === usuarioId) {
    return res.status(400).json({ error: 'Para eliminar tu propia cuenta usa la opción "Darme de baja".' });
  }

  try {
    await enTransaccion(async (cliente) => {
      const integrantes = await integrantesBloqueados(cliente, familiaId);
      if (!integrantes.some((i) => i.id === id)) {
        throw new ErrorNegocio(404, 'El integrante no pertenece a tu familia.');
      }
      await anonimizarUsuario(cliente, id);
    });
    return res.json({ success: true, message: 'Integrante eliminado y sus datos personales borrados.' });
  } catch (err: any) {
    return responderError(res, err, 'eliminar al integrante');
  }
});

// RNF32_ Baja solicitada por el propio usuario
router.delete('/cuenta', async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  if (textoRecortado(req.body?.confirmacion) !== 'ELIMINAR') {
    return res.status(400).json({ error: 'Confirmación: escribe ELIMINAR para darte de baja.' });
  }

  try {
    await enTransaccion(async (cliente) => {
      const integrantes = await integrantesBloqueados(cliente, familiaId);
      const yo = integrantes.find((i) => i.id === usuarioId);
      const otrosAdmins = integrantes.filter((i) => i.rol_id === ROL_ADMIN && i.id !== usuarioId).length;
      if (yo?.rol_id === ROL_ADMIN && integrantes.length > 1 && otrosAdmins === 0) {
        throw new ErrorNegocio(400, 'Antes de darte de baja, nombra a otro administrador de la familia.');
      }
      await anonimizarUsuario(cliente, usuarioId);
      if (integrantes.length === 1) {
        await cliente.query('DELETE FROM familias WHERE id = $1::bigint', [familiaId]);
      }
    });
    return res.json({ success: true, message: 'Tu cuenta fue eliminada.' });
  } catch (err: any) {
    return responderError(res, err, 'dar de baja la cuenta');
  }
});

// RF039_ Permisos del rol integrante dentro de esta familia
router.get('/permisos', soloAdmin, async (req: PeticionGastos, res: Response) => {
  try {
    const filas = await pool.query(
      `SELECT p.clave, p.descripcion,
              COALESCE(frp.permitido, rp.permiso_clave IS NOT NULL) AS permitido
         FROM permisos p
         LEFT JOIN rol_permisos rp ON rp.permiso_clave = p.clave AND rp.rol_id = $2::smallint
         LEFT JOIN familia_rol_permisos frp
                ON frp.permiso_clave = p.clave AND frp.rol_id = $2::smallint AND frp.familia_id = $1::bigint
        ORDER BY p.clave`,
      [req.contexto!.familiaId, ROL_INTEGRANTE]
    );
    return res.json({ success: true, permisos: filas.rows });
  } catch (err: any) {
    return responderError(res, err, 'consultar los permisos');
  }
});

router.put('/permisos', soloAdmin, async (req: PeticionGastos, res: Response) => {
  const clave = textoRecortado(req.body?.clave);
  if (!clave || typeof req.body?.permitido !== 'boolean') {
    return res.status(400).json({ error: 'Indica el permiso y si está permitido.' });
  }
  try {
    const existe = await pool.query('SELECT 1 FROM permisos WHERE clave = $1::varchar', [clave]);
    if (existe.rows.length === 0) return res.status(404).json({ error: 'El permiso indicado no existe.' });
    await pool.query(
      `INSERT INTO familia_rol_permisos (familia_id, rol_id, permiso_clave, permitido)
       VALUES ($1::bigint, $2::smallint, $3::varchar, $4::boolean)
       ON CONFLICT (familia_id, rol_id, permiso_clave) DO UPDATE SET permitido = EXCLUDED.permitido`,
      [req.contexto!.familiaId, ROL_INTEGRANTE, clave, req.body.permitido]
    );
    return res.json({ success: true, message: 'Permiso actualizado.' });
  } catch (err: any) {
    return responderError(res, err, 'actualizar el permiso');
  }
});

export default router;
