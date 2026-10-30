import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const password = process.env.DB_PASSWORD;
if (!password) {
  throw new Error('Falta configurar DB_PASSWORD en server/.env.');
}

export const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'famify',
  password,
  port: Number(process.env.DB_PORT) || 5432,
});

pool.on('connect', () => {
  console.log('✅ Conectado exitosamente a PostgreSQL local');
});