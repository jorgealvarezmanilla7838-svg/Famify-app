import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import https from 'https';
import os from 'os';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

import { pool } from './db';
import { secretoJwt, verificarToken } from './modulos/auth/auth.middleware';
import authRouter from './modulos/auth/auth.routes';
import administracionRouter from './modulos/administracion/administracion.routes';
import { cabecerasSeguras, exigirHttps, medirTiempo, sanitizarEntrada } from './modulos/compartido/seguridad';
import configuracionRouter from './modulos/configuracion/configuracion.routes';
import gastosRouter from './modulos/gastos/gastos.routes';
import ingresosRouter from './modulos/ingresos/ingresos.routes';
import metasRouter from './modulos/metas/metas.routes';
import notificacionesRouter from './modulos/notificaciones/notificaciones.routes';
import { iniciarNotificaciones } from './modulos/notificaciones/notificaciones.servicio';
import presupuestoRouter from './modulos/presupuesto/presupuesto.routes';
import reportesRouter from './modulos/reportes/reportes.routes';
import { iniciarRespaldos } from './modulos/respaldos/respaldos';

secretoJwt();

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// RNF02_ Rutas del certificado, relativas a la carpeta server (npm run tls:generar crea uno de desarrollo)
const rutaServidor = (ruta: string) => path.resolve(__dirname, '..', ruta);
const certificadoTls = process.env.TLS_CERT && process.env.TLS_KEY
  ? { cert: fs.readFileSync(rutaServidor(process.env.TLS_CERT)), key: fs.readFileSync(rutaServidor(process.env.TLS_KEY)) }
  : null;

// Si no se configura CLIENT_URL, se acepta el cliente en el puerto 5173 de esta computadora y de sus IP de red
// (así funciona tanto en localhost como desde otra máquina, por ejemplo Kali), por HTTP y por HTTPS.
const origenesPorDefecto = () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
  return ['localhost', '127.0.0.1', ...ips].flatMap((h) => [`https://${h}:5173`, `http://${h}:5173`]);
};
const origenes = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map((o) => o.trim())
  : origenesPorDefecto();

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(medirTiempo);
app.use(exigirHttps);
app.use(cabecerasSeguras);
app.use(cors({ origin: origenes, exposedHeaders: ['Server-Timing'] }));
app.use(express.json({ limit: '100kb' }));
app.use(sanitizarEntrada);

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', message: 'Servidor de Famify corriendo correctamente.' });
  } catch {
    res.status(503).json({ status: 'error', message: 'Servicio no disponible por el momento.' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/configuracion', verificarToken, configuracionRouter);
app.use('/api/gastos', verificarToken, gastosRouter);
app.use('/api/ingresos', verificarToken, ingresosRouter);
app.use('/api/presupuestos', verificarToken, presupuestoRouter);
app.use('/api/metas', verificarToken, metasRouter);
app.use('/api/reportes', verificarToken, reportesRouter);
app.use('/api/notificaciones', verificarToken, notificacionesRouter);
app.use('/api/administracion', verificarToken, administracionRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'La ruta solicitada no existe.' });
});

// RNF16_ Ningún error inesperado llega al usuario con detalles técnicos
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Los datos enviados no son válidos.' });
  }
  console.error('Error no controlado:', err.message);
  return res.status(500).json({ error: 'Ocurrió un problema en el servidor. Intenta de nuevo.' });
});

const alIniciar = (protocolo: string) => () => {
  console.log(`Servidor Famify iniciado en ${protocolo}://localhost:${PORT}`);
  iniciarNotificaciones();
  iniciarRespaldos();
};

// RNF02_ Con TLS_CERT y TLS_KEY el servidor atiende directamente por HTTPS (TLS 1.2 o superior).
// Si además se define HTTP_REDIRECCION_PUERTO, ese puerto solo redirige (301) a la dirección HTTPS.
const servidor = certificadoTls
  ? https.createServer({ ...certificadoTls, minVersion: 'TLSv1.2' }, app).listen(PORT, alIniciar('https'))
  : app.listen(PORT, alIniciar('http'));

// RNF12_ Conexiones persistentes: los clientes reutilizan la conexión (y el saludo TLS) entre peticiones
servidor.keepAliveTimeout = 65000;
servidor.headersTimeout = 66000;

const puertoRedireccion = Number(process.env.HTTP_REDIRECCION_PUERTO);
if (certificadoTls && puertoRedireccion) {
  http
    .createServer((req, res) => {
      const host = (req.headers.host || 'localhost').replace(/:\d+$/, '');
      res.writeHead(301, { Location: `https://${host}:${PORT}${req.url || '/'}` });
      res.end();
    })
    .listen(puertoRedireccion, () =>
      console.log(`Redirección HTTP -> HTTPS activa en http://localhost:${puertoRedireccion}`)
    );
}

// RNF13_ Un error inesperado se registra y el servidor sigue atendiendo; al apagarlo se cierra con orden
process.on('unhandledRejection', (motivo) => console.error('Promesa rechazada sin manejar:', motivo));
process.on('uncaughtException', (err) => console.error('Error inesperado:', err.message));
const apagar = () => {
  servidor.close(() => void pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 10000).unref();
};
process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
