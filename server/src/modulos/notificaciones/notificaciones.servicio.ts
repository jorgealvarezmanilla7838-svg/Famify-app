import { pool } from '../../db';
import { fechaLocal } from '../gastos/gastos.validaciones';
import { listarPresupuestos } from '../presupuesto/presupuesto.servicio';

const DIAS_AVISO_TARJETA = 3;
// RNF17_ Revisar cada 5 minutos cumple la tolerancia máxima de 15 minutos
const INTERVALO_MS = 5 * 60 * 1000;

const ultimoDiaDelMes = (anio: number, mes: number) => new Date(anio, mes + 1, 0).getDate();

// Siguiente fecha en que cae un "día del mes". Un día 31 en noviembre se toma como el 30.
export const proximaFecha = (dia: number, hoy: Date) => {
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const enMes = (anio: number, mes: number) => new Date(anio, mes, Math.min(dia, ultimoDiaDelMes(anio, mes)));
  const esteMes = enMes(inicioHoy.getFullYear(), inicioHoy.getMonth());
  return esteMes >= inicioHoy ? esteMes : enMes(inicioHoy.getFullYear(), inicioHoy.getMonth() + 1);
};

export const diasEntre = (hoy: Date, fecha: Date) => {
  const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((fecha.getTime() - inicioHoy.getTime()) / 86400000);
};

const cuando = (dias: number) => (dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`);
const dinero = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);

const crear = (usuarioId: number, tipo: string, titulo: string, mensaje: string, clave: string) =>
  pool.query(
    `INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, clave)
     VALUES ($1::bigint, $2::varchar, $3::varchar, $4::varchar, $5::varchar)
     ON CONFLICT (usuario_id, clave) DO NOTHING`,
    [usuarioId, tipo, titulo, mensaje, clave]
  );

// RF032_ / RF033_ Recordatorios de tarjetas de crédito
const revisarTarjetas = async (hoy: Date) => {
  const tarjetas = await pool.query(
    `SELECT ump.id, ump.usuario_id, ump.alias, ump.dia_corte, ump.dia_limite_pago
       FROM usuario_metodos_pago ump
       JOIN metodos_pago mp ON mp.id = ump.metodo_pago_id AND mp.es_credito
       JOIN usuarios u ON u.id = ump.usuario_id AND u.activo
      WHERE ump.activo`
  );
  for (const t of tarjetas.rows) {
    const avisos = [
      { dia: t.dia_corte, tipo: 'corte', titulo: 'Fecha de corte próxima', texto: 'hace corte' },
      { dia: t.dia_limite_pago, tipo: 'limite_pago', titulo: 'Fecha límite de pago próxima', texto: 'debe pagarse' },
    ];
    for (const aviso of avisos) {
      if (!aviso.dia) continue;
      const fecha = proximaFecha(Number(aviso.dia), hoy);
      const dias = diasEntre(hoy, fecha);
      if (dias <= DIAS_AVISO_TARJETA) {
        await crear(
          Number(t.usuario_id),
          aviso.tipo,
          aviso.titulo,
          `Tu tarjeta "${t.alias}" ${aviso.texto} ${cuando(dias)}.`,
          // Con el alias y no con el id, para no repetir el aviso si el usuario edita su configuración
          `${aviso.tipo}:${String(t.alias).toLowerCase()}:${fechaLocal(fecha)}`
        );
      }
    }
  }
};

// RF034_ Recordatorios de gastos fijos
const revisarGastosFijos = async (hoy: Date) => {
  const gastos = await pool.query(
    `SELECT gf.id, gf.usuario_id, gf.descripcion, gf.monto, gf.dia_pago, gf.dias_aviso
       FROM gastos_fijos gf JOIN usuarios u ON u.id = gf.usuario_id AND u.activo
      WHERE gf.activo`
  );
  for (const g of gastos.rows) {
    const fecha = proximaFecha(Number(g.dia_pago), hoy);
    const dias = diasEntre(hoy, fecha);
    if (dias <= Number(g.dias_aviso)) {
      await crear(
        Number(g.usuario_id),
        'gasto_fijo',
        'Gasto fijo próximo',
        `"${g.descripcion}" por ${dinero(Number(g.monto))} se paga ${cuando(dias)}.`,
        `gasto_fijo:${String(g.descripcion).toLowerCase().slice(0, 90)}:${fechaLocal(fecha)}`
      );
    }
  }
};

// RF022_ / RF035_ Presupuestos cerca del límite o excedidos. RF036_ Déficit del mes.
const revisarFamilias = async (hoy: Date) => {
  const familias = await pool.query(
    `SELECT f.id, array_agg(u.id) AS integrantes
       FROM familias f JOIN usuarios u ON u.familia_id = f.id AND u.activo
      GROUP BY f.id`
  );
  const fechaHoy = fechaLocal(hoy);
  const inicioMes = fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1));

  for (const familia of familias.rows) {
    const familiaId = Number(familia.id);
    const integrantes: number[] = familia.integrantes.map(Number);
    const avisos: { tipo: string; titulo: string; mensaje: string; clave: string }[] = [];

    for (const p of await listarPresupuestos(familiaId, fechaHoy)) {
      if (p.estado !== 'ok') {
        avisos.push({
          tipo: 'presupuesto',
          titulo: p.estado === 'excedido' ? 'Presupuesto excedido' : 'Presupuesto cerca del límite',
          mensaje: `"${p.nombre}": van ${dinero(p.gastado)} de ${dinero(p.monto_total)}.`,
          clave: `presupuesto:${p.id}:${p.estado}`,
        });
      }
      for (const c of p.categorias) {
        if (c.estado !== 'ok') {
          avisos.push({
            tipo: 'presupuesto',
            titulo: c.estado === 'excedido' ? `${c.categoria}: límite excedido` : `${c.categoria}: cerca del límite`,
            mensaje: `En "${p.nombre}" van ${dinero(c.gastado)} de ${dinero(c.monto)}.`,
            clave: `presupuesto:${p.id}:${c.categoria_id}:${c.estado}`,
          });
        }
      }
    }

    const balance = await pool.query(
      `SELECT (SELECT COALESCE(sum(i.monto), 0) FROM ingresos i JOIN usuarios u ON u.id::text = i.usuario_id
                WHERE u.familia_id = $1::bigint AND i.fecha >= $2::date AND i.fecha < ($3::date + 1)) AS ingresos,
              (SELECT COALESCE(sum(g.monto), 0) FROM gastos g
                WHERE g.familia_id = $1::bigint AND g.fecha BETWEEN $2::date AND $3::date) AS gastos`,
      [familiaId, inicioMes, fechaHoy]
    );
    const ingresos = Number(balance.rows[0].ingresos);
    const gastos = Number(balance.rows[0].gastos);
    if (gastos > ingresos) {
      avisos.push({
        tipo: 'deficit',
        titulo: 'Déficit este mes',
        mensaje: `Los gastos (${dinero(gastos)}) superan a los ingresos (${dinero(ingresos)}).`,
        clave: `deficit:${inicioMes.slice(0, 7)}`,
      });
    }

    for (const aviso of avisos) {
      for (const usuarioId of integrantes) {
        await crear(usuarioId, aviso.tipo, aviso.titulo, aviso.mensaje, aviso.clave);
      }
    }
  }
};

export const generarNotificaciones = async (hoy = new Date()) => {
  await revisarTarjetas(hoy);
  await revisarGastosFijos(hoy);
  await revisarFamilias(hoy);
};

export const iniciarNotificaciones = () => {
  const ejecutar = () =>
    generarNotificaciones()
      // RNF30_ Las sesiones vencidas no se acumulan
      .then(() => pool.query(`DELETE FROM sesiones WHERE ultima_actividad < now() - interval '1 day'`))
      .catch((err) => console.error('Error al generar notificaciones:', err.message));
  void ejecutar();
  setInterval(ejecutar, INTERVALO_MS);
};
