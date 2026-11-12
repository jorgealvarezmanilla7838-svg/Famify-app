import type { Pool, PoolClient } from 'pg';

// Roles base del sistema (rolfamiliar con familia_id NULL)
export const ROL_ADMIN = 1;
export const ROL_INTEGRANTE = 2;

type Consulta = Pick<Pool | PoolClient, 'query'>;

// RF039_ Cuando el administrador cambia los permisos de los integrantes, la familia recibe su propio
// rol "integrante" (los roles base no se pueden editar). Este es el id del rol que deben usar los integrantes.
export const rolIntegranteDeFamilia = async (db: Consulta, familiaId: number): Promise<number> => {
  const r = await db.query(
    `SELECT id FROM rolfamiliar WHERE familia_id = $1::bigint AND lower(nombre) = 'integrante'`,
    [familiaId]
  );
  return r.rows.length > 0 ? Number(r.rows[0].id) : ROL_INTEGRANTE;
};
