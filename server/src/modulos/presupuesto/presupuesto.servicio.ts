import { pool } from '../../db';

export const UMBRAL_ALERTA = 0.8;

export type EstadoLimite = 'ok' | 'cerca' | 'excedido';

// RF022_ / RF035_ Cerca del límite desde el 80 %, excedido al superarlo
export const estadoLimite = (gastado: number, limite: number): EstadoLimite => {
  if (gastado > limite) return 'excedido';
  return gastado >= limite * UMBRAL_ALERTA ? 'cerca' : 'ok';
};

const redondear = (n: number) => Math.round(n * 100) / 100;

// RF021_ Presupuestos de la familia con lo gastado y lo disponible
export const listarPresupuestos = async (familiaId: number, soloVigentesEn?: string) => {
  const valores: any[] = [familiaId];
  let vigencia = '';
  if (soloVigentesEn) {
    valores.push(soloVigentesEn);
    vigencia = ' AND $2::date BETWEEN p.desde AND p.hasta';
  }

  const [presupuestos, categorias] = await Promise.all([
    pool.query(
      `SELECT p.id, p.nombre, p.monto_total,
              to_char(p.desde, 'YYYY-MM-DD') AS desde, to_char(p.hasta, 'YYYY-MM-DD') AS hasta,
              COALESCE((SELECT sum(g.monto) FROM gastos g
                         WHERE g.familia_id = p.familia_id
                           AND g.fecha BETWEEN p.desde AND p.hasta), 0) AS gastado
         FROM presupuestos p
        WHERE p.familia_id = $1::bigint${vigencia}
        ORDER BY p.hasta DESC, p.id DESC`,
      valores
    ),
    pool.query(
      `SELECT pc.presupuesto_id, pc.categoria_id, c.nombre AS categoria, pc.monto,
              COALESCE((SELECT sum(g.monto) FROM gastos g
                         WHERE g.familia_id = p.familia_id
                           AND g.categoria_id = pc.categoria_id
                           AND g.fecha BETWEEN p.desde AND p.hasta), 0) AS gastado
         FROM presupuesto_categorias pc
         JOIN presupuestos p ON p.id = pc.presupuesto_id
         JOIN categorias c ON c.id = pc.categoria_id
        WHERE p.familia_id = $1::bigint
        ORDER BY c.nombre`,
      [familiaId]
    ),
  ]);

  return presupuestos.rows.map((p: any) => {
    const total = Number(p.monto_total);
    const gastado = Number(p.gastado);
    return {
      id: Number(p.id),
      nombre: p.nombre as string,
      monto_total: total,
      desde: p.desde as string,
      hasta: p.hasta as string,
      gastado,
      disponible: redondear(total - gastado),
      estado: estadoLimite(gastado, total),
      categorias: categorias.rows
        .filter((c: any) => Number(c.presupuesto_id) === Number(p.id))
        .map((c: any) => {
          const monto = Number(c.monto);
          const gastadoCategoria = Number(c.gastado);
          return {
            categoria_id: Number(c.categoria_id),
            categoria: c.categoria as string,
            monto,
            gastado: gastadoCategoria,
            disponible: redondear(monto - gastadoCategoria),
            estado: estadoLimite(gastadoCategoria, monto),
          };
        }),
    };
  });
};
