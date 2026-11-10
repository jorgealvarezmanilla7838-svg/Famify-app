// Aplica famify_db.sql a la base configurada en server/.env.
// El archivo solo agrega lo que falta, así que se puede ejecutar sobre una base con datos.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { Client } = require('pg');

(async () => {
  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'famify',
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 5432,
  });
  await client.connect();
  try {
    await client.query(fs.readFileSync(path.resolve(__dirname, '../../famify_db.sql'), 'utf8'));
    console.log('Esquema aplicado correctamente.');
  } finally {
    await client.end();
  }
})().catch((err) => {
  console.error('No se pudo aplicar el esquema:', err.message);
  process.exit(1);
});
