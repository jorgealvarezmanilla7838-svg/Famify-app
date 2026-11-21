// Punto único de comunicación con el servidor.
// RNF02_ Si no se define VITE_API_URL, la API se pide al mismo servidor que entregó la página (rutas /api),
// y Vite la reenvía al backend. Así el navegador solo usa un origen y un certificado, funciona igual
// en localhost que desde otra computadora de la red, y el protocolo (https) es el mismo de la página.
// En producción VITE_API_URL debe ser una dirección https.
export const API_URL: string = import.meta.env.VITE_API_URL || '';

export const EVENTO_SESION_EXPIRADA = 'famify:sesion-expirada';

export class ErrorApi extends Error {
  errores: string[];
  estado: number;

  constructor(mensaje: string, estado: number, errores?: string[]) {
    super(mensaje);
    this.estado = estado;
    this.errores = errores?.length ? errores : [mensaje];
  }
}

interface OpcionesPedido {
  metodo?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  cuerpo?: unknown;
  // Las consultas automáticas no cuentan como actividad del usuario (RNF05)
  sondeo?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pedir = async <T = any>(ruta: string, opciones: OpcionesPedido = {}): Promise<T> => {
  const token = localStorage.getItem('token');
  const cabeceras: Record<string, string> = {};
  if (opciones.cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  if (token) cabeceras.Authorization = `Bearer ${token}`;
  if (opciones.sondeo) cabeceras['x-famify-sondeo'] = '1';

  let respuesta: Response;
  try {
    respuesta = await fetch(`${API_URL}${ruta}`, {
      method: opciones.metodo ?? 'GET',
      headers: cabeceras,
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
    });
  } catch {
    throw new ErrorApi('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.', 0);
  }

  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    if (respuesta.status === 401 && token) window.dispatchEvent(new Event(EVENTO_SESION_EXPIRADA));
    throw new ErrorApi(datos.error || 'Ocurrió un problema. Intenta de nuevo.', respuesta.status, datos.errores);
  }
  return datos as T;
};

export const mensajesDe = (err: unknown) =>
  err instanceof ErrorApi ? err.errores : ['Ocurrió un problema. Intenta de nuevo.'];
