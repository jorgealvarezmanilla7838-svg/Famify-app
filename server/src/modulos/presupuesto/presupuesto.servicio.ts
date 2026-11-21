import { pool } from '../../db';

export type EstadoLimite = 'ok' | 'cerca' | 'excedido';

// RF022_ / RF035_ Cerca del límite desde el umbral del presupuesto (80 % por defecto), excedido al superarlo
export const estadoLimite = (gastado: number, limite: number, umbralPorcentaje = 80): EstadoLimite => {
  if (gastado > limite) return 'excedido';
  return gastado >= limite * (umbralPorcentaje / 100) ? 'cerca' : 'ok';
};

const redondear = (n: number) => Math.round(n * 100) / 100;

// RF021_ Presupuestos de la familia con lo gastado y lo disponible.
// Se usan las vistas de la base de datos (v_presupuesto_estado y v_presupuesto_categoria_estado).
export const listarPresupuestos = async (familiaId: number, soloVigentesEn?: string) => {
  const valores: any[] = [familiaId];
  let vigencia = '';
  if (soloVigentesEn) {
    valores.push(soloVigentesEn);
    vigencia = ' AND $2::date BETWEEN e.fecha_inicio AND e.fecha_fin';
  }

  const [presupuestos, categorias] = await Promise.all([
    pool.query(
      `SELECT e.presupuesto_id AS id, e.periodo AS nombre, e.monto_total, p.umbral_alerta,
              to_char(e.fecha_inicio, 'YYYY-MM-DD') AS desde, to_char(e.fecha_fin, 'YYYY-MM-DD') AS hasta,
              e.gastado
         FROM v_presupuesto_estado e
         JOIN presupuesto p ON p.id = e.presupuesto_id
        WHERE e.familia_id = $1::bigint${vigencia}
        ORDER BY e.fecha_fin DESC, e.presupuesto_id DESC`,
      valores
    ),
    pool.query(
      `SELECT c.presupuesto_id, c.categoria_id, c.categoria, c.monto_asignado AS monto, c.gastado
         FROM v_presupuesto_categoria_estado c
        WHERE c.familia_id = $1::bigint
        ORDER BY c.categoria`,
      [familiaId]
    ),
  ]);

  return presupuestos.rows.map((p: any) => {
    const total = Number(p.monto_total);
    const gastado = Number(p.gastado);
    const umbral = Number(p.umbral_alerta);
    return {
      id: Number(p.id),
      nombre: p.nombre as string,
      monto_total: total,
      desde: p.desde as string,
      hasta: p.hasta as string,
      gastado,
      disponible: redondear(total - gastado),
      estado: estadoLimite(gastado, total, umbral),
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
            estado: estadoLimite(gastadoCategoria, monto, umbral),
          };
        }),
    };
  });
};
