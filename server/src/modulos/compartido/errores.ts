import type { Response } from 'express';

// Error de negocio con un mensaje pensado para el usuario
export class ErrorNegocio extends Error {
  constructor(public estado: number, mensaje: string) {
    super(mensaje);
  }
}

// RNF16_ Traduce cualquier fallo a un mensaje claro, sin exponer detalles técnicos.
// El detalle real solo se escribe en la bitácora del servidor.
export const responderError = (res: Response, err: any, accion: string) => {
  if (err instanceof ErrorNegocio) {
    return res.status(err.estado).json({ error: err.message });
  }
  console.error(`Error al ${accion}:`, err.message);
  if (err.code === 'P0001') {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === '42501') {
    return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
  }
  if (['23502', '23503', '23514', '22003'].includes(err.code)) {
    return res.status(400).json({ error: 'Los datos no cumplen las reglas del sistema.' });
  }
  return res.status(500).json({ error: 'Ocurrió un problema en el servidor. Intenta de nuevo.' });
};

export const montoValido = (valor: unknown) =>
  /^\d+(\.\d{1,2})?$/.test(String(valor ?? '')) && Number(valor) > 0 && Number(valor) <= 9999999999.99;

export const textoRecortado = (valor: unknown) => (typeof valor === 'string' ? valor.trim() : '');
