import { Router, type NextFunction, type Response } from 'express';
import type { PoolClient } from 'pg';
import { enTransaccion, pool } from '../../db';
import { ErrorNegocio, responderError, textoRecortado } from '../compartido/errores';
import { PERMISOS_EDITABLES } from '../compartido/permisos';
import { ROL_ADMIN, ROL_INTEGRANTE, rolIntegranteDeFamilia } from '../compartido/roles';
import { type PeticionGastos, cargarContexto } from '../gastos/gastos.permisos';
import { leerId } from '../gastos/gastos.validaciones';

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
    'SELECT id, rol_id FROM usuario WHERE familia_id = $1::bigint AND activo ORDER BY id FOR UPDATE',
    [familiaId]
  );
  return filas.rows.map((f: any) => ({ id: Number(f.id), rol_id: Number(f.rol_id) }));
};

// El cliente solo distingue administrador (1) e integrante (2), aunque la familia tenga su propio rol integrante
const rolParaCliente = (rolId: number) => (Number(rolId) === ROL_ADMIN ? ROL_ADMIN : ROL_INTEGRANTE);

// RF037_ Consulta de integrantes: esta lista con correos es solo del administrador
router.get('/integrantes', soloAdmin, async (req: PeticionGastos, res: Response) => {
  try {
    const [familia, integrantes] = await Promise.all([
      pool.query('SELECT nombre FROM familia WHERE id = $1::bigint', [req.contexto!.familiaId]),
      pool.query(
        `SELECT u.id, u.nombre, u.email, u.rol_id, r.nombre AS rol,
                to_char(u.created_at, 'YYYY-MM-DD') AS desde
           FROM usuario u JOIN rolfamiliar r ON r.id = u.rol_id
          WHERE u.familia_id = $1::bigint AND u.activo
          ORDER BY (u.rol_id <> ${ROL_ADMIN}), u.nombre`,
        [req.contexto!.familiaId]
      ),
    ]);
    return res.json({
      success: true,
      familia: familia.rows[0]?.nombre ?? '',
      integrantes: integrantes.rows.map((i: any) => ({
        ...i,
        id: Number(i.id),
        rol_id: rolParaCliente(i.rol_id),
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
      pool.query('SELECT nombre FROM familia WHERE id = $1::bigint', [req.contexto!.familiaId]),
      pool.query(
        `SELECT u.id, u.nombre, r.nombre AS rol
           FROM usuario u JOIN rolfamiliar r ON r.id = u.rol_id
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

// RF038_ Asignación y modificación de roles (fn_cambiar_rol valida permiso, familia y rol)
router.put('/integrantes/:id/rol', soloAdmin, async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
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
      const rolNuevo = rolId === ROL_ADMIN ? ROL_ADMIN : await rolIntegranteDeFamilia(cliente, familiaId);
      await cliente.query('SELECT fn_cambiar_rol($1::bigint, $2::bigint, $3::smallint)', [usuarioId, id, rolNuevo]);
    });
    return res.json({ success: true, message: 'Rol actualizado.' });
  } catch (err: any) {
    return responderError(res, err, 'cambiar el rol');
  }
});

// RF040_ Eliminación de integrantes. RNF32_ fn_eliminar_integrante anonimiza sus datos personales
// (los gastos e ingresos quedan a nombre de "Usuario eliminado" para no alterar la contabilidad de la familia).
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
      await cliente.query('SELECT fn_eliminar_integrante($1::bigint, $2::bigint)', [usuarioId, id]);
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
      // La base de datos exige que la familia conserve al menos un administrador
      if (yo?.rol_id === ROL_ADMIN && otrosAdmins === 0) {
        throw new ErrorNegocio(400, 'Eres el único administrador de la familia. Antes de darte de baja, nombra a otro administrador.');
      }
      await cliente.query('SELECT fn_dar_de_baja($1::bigint)', [usuarioId]);
    });
    return res.json({ success: true, message: 'Tu cuenta fue eliminada.' });
  } catch (err: any) {
    return responderError(res, err, 'dar de baja la cuenta');
  }
});

// RF039_ Permisos del rol integrante dentro de esta familia
router.get('/permisos', soloAdmin, async (req: PeticionGastos, res: Response) => {
  try {
    const rolId = await rolIntegranteDeFamilia(pool, req.contexto!.familiaId);
    const rol = await pool.query('SELECT permisos FROM rolfamiliar WHERE id = $1::smallint', [rolId]);
    const activos = new Set<string>(String(rol.rows[0]?.permisos ?? '').split(',').filter(Boolean));
    return res.json({
      success: true,
      permisos: PERMISOS_EDITABLES.map((p) => ({ clave: p.clave, descripcion: p.descripcion, permitido: activos.has(p.clave) })),
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar los permisos');
  }
});

router.put('/permisos', soloAdmin, async (req: PeticionGastos, res: Response) => {
  const { usuarioId, familiaId } = req.contexto!;
  const clave = textoRecortado(req.body?.clave);
  if (!clave || typeof req.body?.permitido !== 'boolean') {
    return res.status(400).json({ error: 'Indica el permiso y si está permitido.' });
  }
  if (!PERMISOS_EDITABLES.some((p) => p.clave === clave)) {
    return res.status(404).json({ error: 'El permiso indicado no existe.' });
  }

  try {
    await enTransaccion(async (cliente) => {
      // Los roles base no se pueden editar: la primera vez la familia recibe su propio rol "integrante",
      // copia del rol base, y sus integrantes e invitaciones pendientes pasan a usarlo.
      let rolId = await rolIntegranteDeFamilia(cliente, familiaId);
      if (rolId === ROL_INTEGRANTE) {
        const base = await cliente.query('SELECT permisos FROM rolfamiliar WHERE id = $1::smallint', [ROL_INTEGRANTE]);
        const creado = await cliente.query('SELECT fn_crear_rol_familiar($1::bigint, $2::text, $3::text) AS id', [
          usuarioId,
          'integrante',
          base.rows[0].permisos,
        ]);
        rolId = Number(creado.rows[0].id);
        await cliente.query(
          'UPDATE usuario SET rol_id = $1::smallint WHERE familia_id = $2::bigint AND rol_id = $3::smallint AND activo',
          [rolId, familiaId, ROL_INTEGRANTE]
        );
        await cliente.query(
          `UPDATE invitacion SET rol_id = $1::smallint
            WHERE familia_id = $2::bigint AND rol_id = $3::smallint AND estado = 'pendiente'`,
          [rolId, familiaId, ROL_INTEGRANTE]
        );
      }

      const actual = await cliente.query('SELECT permisos FROM rolfamiliar WHERE id = $1::smallint', [rolId]);
      const lista = new Set<string>(String(actual.rows[0].permisos).split(',').filter(Boolean));
      if (req.body.permitido) lista.add(clave);
      else lista.delete(clave);

      // fn_definir_permisos_rol valida que el rol sea de la familia y que cada permiso exista
      await cliente.query('SELECT fn_definir_permisos_rol($1::bigint, $2::smallint, $3::text)', [
        usuarioId,
        rolId,
        [...lista].join(','),
      ]);
    });
    return res.json({ success: true, message: 'Permiso actualizado.' });
  } catch (err: any) {
    return responderError(res, err, 'actualizar el permiso');
  }
});

export default router;
