import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_CONSERVADOS = 14;

// RNF14_ Genera con pg_dump un respaldo al arrancar y luego una vez al día.
// Se activa con RESPALDOS_ACTIVOS=true en server/.env.
const respaldar = () => {
  const carpeta = path.resolve(process.env.RESPALDOS_DIR || path.join(__dirname, '../../../respaldos'));
  fs.mkdirSync(carpeta, { recursive: true });
  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const archivo = path.join(carpeta, `famify-${marca}.dump`);

  execFile(
    process.env.PG_DUMP_PATH || 'pg_dump',
    [
      '-h', process.env.DB_HOST || 'localhost',
      '-p', process.env.DB_PORT || '5432',
      '-U', process.env.DB_USER || 'postgres',
      '-F', 'c',
      '-f', archivo,
      process.env.DB_NAME || 'famify',
    ],
    { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD } },
    (error) => {
      if (error) {
        console.error('Error al generar el respaldo:', error.message);
        return;
      }
      console.log('Respaldo generado:', path.basename(archivo));
      const limite = Date.now() - DIAS_CONSERVADOS * UN_DIA_MS;
      for (const nombre of fs.readdirSync(carpeta)) {
        const ruta = path.join(carpeta, nombre);
        if (nombre.endsWith('.dump') && fs.statSync(ruta).mtimeMs < limite) fs.unlinkSync(ruta);
      }
    }
  );
};

export const iniciarRespaldos = () => {
  if (process.env.RESPALDOS_ACTIVOS !== 'true') return;
  respaldar();
  setInterval(respaldar, UN_DIA_MS);
};
