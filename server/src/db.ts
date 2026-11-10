import { Pool, type PoolClient } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const password = process.env.DB_PASSWORD;
if (!password) {
  throw new Error('Falta configurar DB_PASSWORD en server/.env.');
}

// RNF12_ el pool reparte las conexiones cuando hay muchos usuarios simultáneos
export const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'famify',
  password,
  port: Number(process.env.DB_PORT) || 5432,
  max: Number(process.env.DB_POOL_MAX) || 20,
});

// RNF15_ Ejecuta varias operaciones como una sola: si alguna falla, se revierten todas
export const enTransaccion = async <T>(operacion: (cliente: PoolClient) => Promise<T>): Promise<T> => {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await operacion(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    try {
      await cliente.query('ROLLBACK');
    } catch (errorRollback: any) {
      console.error('Error al revertir la transacción:', errorRollback.message);
    }
    throw err;
  } finally {
    cliente.release();
  }
};
