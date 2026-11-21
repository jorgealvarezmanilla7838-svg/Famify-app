import { pool } from '../../db';

// RNF17_ Revisar cada 5 minutos cumple la tolerancia máxima de 15 minutos
const INTERVALO_MS = 5 * 60 * 1000;

// RF032_ a RF036_ Los avisos los genera la propia base de datos:
//  - fn_generar_recordatorios() programa y convierte en notificación los avisos de fecha de corte,
//    fecha límite de pago y gastos fijos (RF032, RF033, RF034).
//  - Los triggers de gastos e ingresos crean las alertas de presupuesto y de déficit (RF022, RF035, RF036).
export const generarNotificaciones = async () => {
  await pool.query('SELECT fn_generar_recordatorios()');
  // RNF06_ Las invitaciones vencidas se marcan como expiradas
  await pool.query('SELECT fn_expirar_invitaciones()');
};

export const iniciarNotificaciones = () => {
  const ejecutar = () =>
    generarNotificaciones().catch((err) => console.error('Error al generar notificaciones:', err.message));
  void ejecutar();
  setInterval(ejecutar, INTERVALO_MS);
};
