import { Request, Response, NextFunction } from 'express';
import { pool } from '../../db';

// Datos del usuario que hace la petición
export interface PeticionGastos extends Request {
  user?: any;
  contexto?: {
    usuarioId: number;
    familiaId: number;
    esAdmin: boolean;
  };
}

// RNF04_ Aislamiento de datos por familia
// la familia y el rol se leen de la base de datos, no del token, porque el token
// se queda viejo si el usuario crea o se une a una familia despues de iniciar sesion
export const cargarContexto = async (req: PeticionGastos, res: Response, next: NextFunction) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.familia_id, ro.nombre AS rol
         FROM usuario u
         LEFT JOIN rolfamiliar ro ON ro.id = u.rol_id
        WHERE u.id = $1::bigint AND u.activo = true`,
      [req.user?.id]
    );

    if (r.rows.length === 0) {
      return res.status(403).json({ error: 'Usuario no válido.' });
    }
    if (!r.rows[0].familia_id) {
      return res.status(403).json({ error: 'Primero debes crear una familia o unirte a una.' });
    }

    req.contexto = {
      usuarioId: Number(r.rows[0].id),
      familiaId: Number(r.rows[0].familia_id),
      esAdmin: r.rows[0].rol === 'administrador',
    };
    next();
  } catch (err: any) {
    console.error('❌ Error al cargar el contexto de gastos:', err.message);
    return res.status(500).json({ error: 'No se pudo validar tu usuario.' });
  }
};

// RNF03_ Control de acceso por rol
// se le pregunta a la base de datos si el usuario tiene el permiso (fn_tiene_permiso)
export const exigirPermiso = (clave: string) => {
  return async (req: PeticionGastos, res: Response, next: NextFunction) => {
    try {
      const r = await pool.query('SELECT fn_tiene_permiso($1::bigint, $2::text) AS ok', [
        req.contexto!.usuarioId,
        clave,
      ]);
      if (!r.rows[0].ok) {
        return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
      }
      next();
    } catch (err: any) {
      console.error('❌ Error al revisar permisos:', err.message);
      return res.status(500).json({ error: 'No se pudo validar tu permiso.' });
    }
  };
};
