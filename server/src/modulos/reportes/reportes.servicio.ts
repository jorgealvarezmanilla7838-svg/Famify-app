import { pool } from '../../db';

export interface ContextoReporte {
  usuarioId: number;
  familiaId: number;
  esAdmin: boolean;
}

export interface FiltrosMovimientos {
  desde: string;
  hasta: string;
  tipo?: 'ingreso' | 'gasto' | null;
  categoriaId?: number | null;
  usuarioId?: number | null;
}

const num = (valor: unknown) => Number(valor ?? 0);

// RF027_ / RF028_ / RF030_ Totales del periodo. RF036_ déficit si salen más que entran.
export const obtenerTotales = async ({ usuarioId, familiaId }: ContextoReporte, desde: string, hasta: string) => {
  const [ingresos, gastos] = await Promise.all([
    pool.query(
      `SELECT COALESCE(sum(i.monto), 0) AS familia,
              COALESCE(sum(i.monto) FILTER (WHERE u.id = $4::bigint), 0) AS mio
         FROM ingresos i JOIN usuarios u ON u.id::text = i.usuario_id
        WHERE u.familia_id = $1::bigint AND i.fecha >= $2::date AND i.fecha < ($3::date + 1)`,
      [familiaId, desde, hasta, usuarioId]
    ),
    pool.query(
      `SELECT COALESCE(sum(monto), 0) AS familia,
              COALESCE(sum(monto) FILTER (WHERE usuario_id = $4::bigint), 0) AS mio
         FROM gastos
        WHERE familia_id = $1::bigint AND fecha BETWEEN $2::date AND $3::date`,
      [familiaId, desde, hasta, usuarioId]
    ),
  ]);

  const armar = (entra: number, sale: number) => ({
    ingresos: entra,
    gastos: sale,
    balance: Math.round((entra - sale) * 100) / 100,
    deficit: sale > entra,
  });

  return {
    familia: armar(num(ingresos.rows[0].familia), num(gastos.rows[0].familia)),
    mio: armar(num(ingresos.rows[0].mio), num(gastos.rows[0].mio)),
  };
};

// RF029_ / RF042_ Gasto por categoría de toda la familia
export const obtenerCategorias = async (familiaId: number, desde: string, hasta: string) => {
  const filas = await pool.query(
    'SELECT categoria_id, categoria, total, porcentaje FROM fn_gastos_por_categoria($1::bigint, $2::date, $3::date)',
    [familiaId, desde, hasta]
  );
  return filas.rows.map((f: any) => ({
    categoria_id: Number(f.categoria_id),
    categoria: f.categoria as string,
    total: num(f.total),
    porcentaje: num(f.porcentaje),
  }));
};

// RF030_ Serie mensual para comparar entradas contra salidas
export const obtenerPorMes = async (familiaId: number, desde: string, hasta: string) => {
  const filas = await pool.query(
    `SELECT mes, sum(ingresos) AS ingresos, sum(gastos) AS gastos FROM (
       SELECT to_char(i.fecha, 'YYYY-MM') AS mes, i.monto AS ingresos, 0::numeric AS gastos
         FROM ingresos i JOIN usuarios u ON u.id::text = i.usuario_id
        WHERE u.familia_id = $1::bigint AND i.fecha >= $2::date AND i.fecha < ($3::date + 1)
       UNION ALL
       SELECT to_char(g.fecha, 'YYYY-MM'), 0::numeric, g.monto
         FROM gastos g
        WHERE g.familia_id = $1::bigint AND g.fecha BETWEEN $2::date AND $3::date
     ) movimientos GROUP BY mes ORDER BY mes`,
    [familiaId, desde, hasta]
  );
  return filas.rows.map((f: any) => ({ mes: f.mes as string, ingresos: num(f.ingresos), gastos: num(f.gastos) }));
};

// RF027_ / RF041_ Lista de movimientos. El integrante solo recibe el detalle propio.
export const obtenerMovimientos = async (contexto: ContextoReporte, filtros: FiltrosMovimientos) => {
  const valores: any[] = [contexto.familiaId, filtros.desde, filtros.hasta];
  let extraIngresos = '';
  let extraGastos = '';

  const usuario = contexto.esAdmin ? filtros.usuarioId : contexto.usuarioId;
  if (usuario) {
    valores.push(usuario);
    extraIngresos += ` AND u.id = $${valores.length}::bigint`;
    extraGastos += ` AND g.usuario_id = $${valores.length}::bigint`;
  }
  if (filtros.categoriaId) {
    valores.push(filtros.categoriaId);
    extraGastos += ` AND g.categoria_id = $${valores.length}::bigint`;
  }

  const consultaIngresos = `
    SELECT 'ingreso' AS tipo, to_char(i.fecha, 'YYYY-MM-DD') AS fecha, i.monto,
           i.fuente::text AS concepto, i.tipo::text AS clasificacion, NULL::text AS metodo_pago, u.nombre::text AS integrante
      FROM ingresos i JOIN usuarios u ON u.id::text = i.usuario_id
     WHERE u.familia_id = $1::bigint AND i.fecha >= $2::date AND i.fecha < ($3::date + 1)${extraIngresos}`;
  const consultaGastos = `
    SELECT 'gasto' AS tipo, to_char(g.fecha, 'YYYY-MM-DD') AS fecha, g.monto,
           COALESCE(g.descripcion, c.nombre)::text AS concepto, c.nombre::text AS clasificacion,
           mp.nombre::text AS metodo_pago, u.nombre::text AS integrante
      FROM gastos g
      JOIN categorias c ON c.id = g.categoria_id
      JOIN metodos_pago mp ON mp.id = g.metodo_pago_id
      JOIN usuarios u ON u.id = g.usuario_id
     WHERE g.familia_id = $1::bigint AND g.fecha BETWEEN $2::date AND $3::date${extraGastos}`;

  // Filtrar por categoría solo tiene sentido en gastos
  const partes: string[] = [];
  if (filtros.tipo !== 'gasto' && !filtros.categoriaId) partes.push(consultaIngresos);
  if (filtros.tipo !== 'ingreso') partes.push(consultaGastos);

  if (partes.length === 0) return [];

  // Sin límite de filas: los totales de los reportes se calculan sobre esta lista.
  // El periodo ya está acotado a un año por leerPeriodo.
  const filas = await pool.query(`${partes.join(' UNION ALL ')} ORDER BY fecha DESC`, valores);
  return filas.rows.map((f: any) => ({ ...f, monto: num(f.monto) }));
};
