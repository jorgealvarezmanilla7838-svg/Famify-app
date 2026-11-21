// Aplica el script oficial famify_db.sql a la base configurada en server/.env.
// El script oficial se corre UNA sola vez sobre una base vacía: si ya existe la tabla "usuario", no hace nada.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { Client } = require('pg');

(async () => {
  const archivo = path.resolve(__dirname, '../../famify_db.sql');
  if (!fs.existsSync(archivo)) {
    throw new Error('No se encontró famify_db.sql en la carpeta del proyecto. Coloca ahí el script oficial.');
  }
  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'famify',
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 5432,
  });
  await client.connect();
  try {
    const existe = await client.query("SELECT to_regclass('public.usuario') AS tabla");
    if (existe.rows[0].tabla) {
      console.log('La base ya tiene el esquema oficial (tabla usuario). No se aplicó nada.');
      return;
    }
    await client.query(fs.readFileSync(archivo, 'utf8'));
    console.log('Esquema aplicado correctamente.');
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error('No se pudo aplicar el esquema:', err.message);
  process.exit(1);
});
