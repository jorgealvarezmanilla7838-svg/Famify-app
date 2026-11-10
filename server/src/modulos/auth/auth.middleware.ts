import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { pool } from '../../db';

export interface TokenUsuario extends JwtPayload {
  id: number;
  sid: string;
}

export interface AuthRequest extends Request {
  user?: TokenUsuario;
}

export const secretoJwt = () => {
  const secreto = process.env.JWT_SECRET;
  if (!secreto) throw new Error('Falta configurar JWT_SECRET en server/.env.');
  return secreto;
};

// RNF05_ El token solo vale mientras su sesión siga abierta y con actividad reciente.
// Las consultas automáticas (cabecera x-famify-sondeo) no cuentan como actividad.
export const verificarToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const [tipo, token] = (req.headers.authorization ?? '').split(' ');
  if (tipo?.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).json({ error: 'Acceso denegado. Inicia sesión.' });
  }

  let datos: TokenUsuario;
  try {
    const verificado = jwt.verify(token, secretoJwt());
    if (typeof verificado === 'string' || typeof verificado.id !== 'number' || typeof verificado.sid !== 'string') {
      return res.status(401).json({ error: 'Sesión no válida. Inicia sesión nuevamente.' });
    }
    datos = verificado as TokenUsuario;
  } catch {
    return res.status(401).json({ error: 'Tu sesión expiró. Inicia sesión nuevamente.' });
  }

  const condicion = `id = $1::uuid AND usuario_id = $2::bigint AND cerrada_en IS NULL
                     AND ultima_actividad > now() - interval '30 minutes'`;
  const consulta = req.headers['x-famify-sondeo']
    ? `SELECT id FROM sesiones WHERE ${condicion}`
    : `UPDATE sesiones SET ultima_actividad = now() WHERE ${condicion} RETURNING id`;

  try {
    const sesion = await pool.query(consulta, [datos.sid, datos.id]);
    if (sesion.rows.length === 0) {
      return res.status(401).json({ error: 'Tu sesión expiró por inactividad. Inicia sesión nuevamente.' });
    }
    req.user = datos;
    return next();
  } catch (err: any) {
    console.error('Error al validar la sesión:', err.message);
    return res.status(500).json({ error: 'No se pudo validar tu sesión. Intenta de nuevo.' });
  }
};
