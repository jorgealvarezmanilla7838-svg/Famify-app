import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { pool } from '../../db';

// El token lleva el id del usuario y su "version_token" (columna de la tabla usuario).
// Al cerrar sesión la versión sube y el token anterior deja de servir (RNF05).
export interface TokenUsuario extends JwtPayload {
  id: number;
  v: number;
}

export interface AuthRequest extends Request {
  user?: TokenUsuario;
}

export const secretoJwt = () => {
  const secreto = process.env.JWT_SECRET;
  if (!secreto) throw new Error('Falta configurar JWT_SECRET en server/.env.');
  return secreto;
};

// RNF05_ El token solo vale mientras su sesión siga abierta y con actividad reciente (30 min).
// fn_validar_sesion renueva la actividad; las consultas automáticas (cabecera x-famify-sondeo)
// solo comprueban la sesión y no cuentan como actividad.
export const verificarToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const [tipo, token] = (req.headers.authorization ?? '').split(' ');
  if (tipo?.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).json({ error: 'Acceso denegado. Inicia sesión.' });
  }

  let datos: TokenUsuario;
  try {
    const verificado = jwt.verify(token, secretoJwt());
    if (typeof verificado === 'string' || typeof verificado.id !== 'number' || typeof verificado.v !== 'number') {
      return res.status(401).json({ error: 'Sesión no válida. Inicia sesión nuevamente.' });
    }
    datos = verificado as TokenUsuario;
  } catch {
    return res.status(401).json({ error: 'Tu sesión expiró. Inicia sesión nuevamente.' });
  }

  try {
    let vigente: boolean;
    if (req.headers['x-famify-sondeo']) {
      const r = await pool.query(
        `SELECT 1 FROM usuario
          WHERE id = $1::bigint AND activo AND version_token = $2::int
            AND ultima_actividad > now() - interval '30 minutes'`,
        [datos.id, datos.v]
      );
      vigente = r.rows.length > 0;
    } else {
      const r = await pool.query('SELECT fn_validar_sesion($1::bigint, $2::int) AS ok', [datos.id, datos.v]);
      vigente = r.rows[0]?.ok === true;
    }
    if (!vigente) {
      return res.status(401).json({ error: 'Tu sesión expiró por inactividad. Inicia sesión nuevamente.' });
    }
    req.user = datos;
    return next();
  } catch (err: any) {
    console.error('Error al validar la sesión:', err.message);
    return res.status(500).json({ error: 'No se pudo validar tu sesión. Intenta de nuevo.' });
  }
};
