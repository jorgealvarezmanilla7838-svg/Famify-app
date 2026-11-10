import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import https from 'https';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

import { pool } from './db';
import { secretoJwt, verificarToken } from './modulos/auth/auth.middleware';
import authRouter from './modulos/auth/auth.routes';
import administracionRouter from './modulos/administracion/administracion.routes';
import { cabecerasSeguras, exigirHttps, sanitizarEntrada } from './modulos/compartido/seguridad';
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
const origenes = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((o) => o.trim());

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(exigirHttps);
app.use(cabecerasSeguras);
app.use(cors({ origin: origenes }));
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

// RNF02_ Con TLS_CERT y TLS_KEY el servidor atiende directamente por HTTPS
if (process.env.TLS_CERT && process.env.TLS_KEY) {
  https
    .createServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }, app)
    .listen(PORT, alIniciar('https'));
} else {
  app.listen(PORT, alIniciar('http'));
}
