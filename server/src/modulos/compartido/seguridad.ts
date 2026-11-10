import type { NextFunction, Request, Response } from 'express';

const CAMPOS_SIN_LIMPIAR = new Set(['password']);

const limpiar = (valor: unknown): unknown => {
  if (typeof valor === 'string') return valor.replace(/<[^>]*>/g, '').trim();
  if (Array.isArray(valor)) return valor.map(limpiar);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(
      Object.entries(valor).map(([clave, v]) => [clave, CAMPOS_SIN_LIMPIAR.has(clave) ? v : limpiar(v)])
    );
  }
  return valor;
};

// RNF08_ Quita etiquetas HTML de lo que envía el usuario (XSS).
// La inyección SQL se evita porque todas las consultas usan parámetros.
export const sanitizarEntrada = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body && typeof req.body === 'object') req.body = limpiar(req.body);
  next();
};

export const cabecerasSeguras = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
};

// RNF02_ En producción solo se atiende por HTTPS
export const exigirHttps = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV !== 'production') return next();
  if (!req.secure) {
    return res.status(403).json({ error: 'La conexión debe realizarse mediante HTTPS.' });
  }
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return next();
};
