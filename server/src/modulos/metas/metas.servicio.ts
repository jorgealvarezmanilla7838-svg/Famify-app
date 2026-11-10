import { pool } from '../../db';

export interface ContextoMetas {
  usuarioId: number;
  familiaId: number;
  esAdmin: boolean;
}

// RF025_ / RF031_ Metas visibles: las familiares, las propias y, para el administrador, todas
export const listarMetas = async ({ usuarioId, familiaId, esAdmin }: ContextoMetas) => {
  const metas = await pool.query(
    `SELECT m.id, m.nombre, m.descripcion, m.monto_objetivo, m.monto_ahorrado,
            to_char(m.fecha_limite, 'YYYY-MM-DD') AS fecha_limite,
            m.usuario_id, m.creada_por, u.nombre AS integrante
       FROM metas_ahorro m
       LEFT JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.familia_id = $1::bigint
        AND ($2::boolean OR m.usuario_id IS NULL OR m.usuario_id = $3::bigint)
      ORDER BY m.created_at DESC, m.id DESC`,
    [familiaId, esAdmin, usuarioId]
  );

  return metas.rows.map((m: any) => {
    const objetivo = Number(m.monto_objetivo);
    const ahorrado = Number(m.monto_ahorrado);
    const dueno = m.usuario_id === null ? null : Number(m.usuario_id);
    return {
      id: Number(m.id),
      nombre: m.nombre as string,
      descripcion: m.descripcion as string | null,
      monto_objetivo: objetivo,
      monto_ahorrado: ahorrado,
      faltante: Math.max(0, Math.round((objetivo - ahorrado) * 100) / 100),
      porcentaje: Math.min(100, Math.round((ahorrado / objetivo) * 10000) / 100),
      fecha_limite: m.fecha_limite as string | null,
      alcance: dueno === null ? 'familia' : 'personal',
      usuario_id: dueno,
      integrante: m.integrante as string | null,
      puede_editar: esAdmin || Number(m.creada_por) === usuarioId || dueno === usuarioId,
    };
  });
};
