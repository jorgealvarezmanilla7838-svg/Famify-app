// Levanta una app Express mínima con un router del proyecto en un puerto libre, para probar sus rutas.
import express, { type NextFunction, type Request, type RequestHandler, type Response, type Router } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { sanitizarEntrada } from '../../src/modulos/compartido/seguridad';

export interface RespuestaPrueba {
  estado: number;
  cuerpo: any;
  cabeceras: Headers;
}

export interface ServidorPrueba {
  pedir: (metodo: string, ruta: string, cuerpo?: unknown, cabeceras?: Record<string, string>) => Promise<RespuestaPrueba>;
  cerrar: () => Promise<void>;
  // id del usuario "autenticado" en las rutas protegidas (simula lo que deja verificarToken)
  usuario: { id: number };
}

export const levantar = async (
  router: Router,
  opciones: { base?: string; autenticado?: boolean; antes?: RequestHandler[] } = {}
): Promise<ServidorPrueba> => {
  const usuario = { id: 1 };
  const app = express();
  app.use(express.json());
  app.use(sanitizarEntrada);
  for (const m of opciones.antes ?? []) app.use(m);
  if (opciones.autenticado !== false) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).user = { id: usuario.id, v: 1 };
      next();
    });
  }
  app.use(opciones.base ?? '/', router);

  const servidor: Server = await new Promise((listo) => {
    const s = app.listen(0, '127.0.0.1', () => listo(s));
  });
  const { port } = servidor.address() as AddressInfo;

  return {
    usuario,
    pedir: async (metodo, ruta, cuerpo, cabeceras = {}) => {
      const res = await fetch(`http://127.0.0.1:${port}${ruta}`, {
        method: metodo,
        headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...cabeceras },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : null,
      });
      const texto = await res.text();
      let datos: any = texto;
      try {
        datos = JSON.parse(texto);
      } catch {
        /* respuesta sin JSON */
      }
      return { estado: res.status, cuerpo: datos, cabeceras: res.headers };
    },
    cerrar: () => new Promise((listo) => servidor.close(() => listo())),
  };
};

// Silencia console.error durante una prueba que provoca errores a propósito
export const silenciarErrores = () => {
  const original = console.error;
  console.error = () => undefined;
  return () => {
    console.error = original;
  };
};
