import nodemailer from 'nodemailer';
import { pool } from '../../db';

// RNF17_ Revisar cada 30 segundos cumple la tolerancia máxima de 15 minutos
const INTERVALO_MS = 30 * 1000;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  pool: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const escapar = (texto: string) =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Solo se envían por correo las notificaciones creadas después de arrancar el servidor
let ultimoIdEnviado = 0;
let enviandoCorreos = false;

// RF032_ a RF036_ Los avisos los genera la propia base de datos:
//  - fn_generar_recordatorios() programa y convierte en notificación los avisos de fecha de corte,
//    fecha límite de pago y gastos fijos (RF032, RF033, RF034).
//  - Los triggers de gastos e ingresos crean las alertas de presupuesto y de déficit (RF022, RF035, RF036).
export const generarNotificaciones = async () => {
  await pool.query('SELECT fn_generar_recordatorios()');
  // RNF06_ Las invitaciones vencidas se marcan como expiradas
  await pool.query('SELECT fn_expirar_invitaciones()');
};

// Manda por correo las notificaciones nuevas, un solo correo por usuario en cada revisión
const enviarNotificacionesPorCorreo = async () => {
  if (enviandoCorreos) return;
  enviandoCorreos = true;
  try {
    const nuevas = await pool.query(
      `SELECT n.id, n.mensaje, u.email
         FROM notificacion n
         JOIN usuario u ON u.id = n.usuario_id
        WHERE n.id > $1::bigint AND n.leida_en IS NULL AND u.activo
        ORDER BY n.id`,
      [ultimoIdEnviado]
    );
    if (nuevas.rows.length === 0) return;

    const porUsuario = new Map<string, string[]>();
    for (const n of nuevas.rows) {
      porUsuario.set(n.email, [...(porUsuario.get(n.email) ?? []), n.mensaje]);
    }
    ultimoIdEnviado = Number(nuevas.rows[nuevas.rows.length - 1].id);

    for (const [email, mensajes] of porUsuario) {
      try {
        await transporter.sendMail({
          from: `"Famify" <${process.env.SMTP_USER}>`,
          to: email,
          subject: 'Nueva notificación en Famify',
          text: mensajes.join('\n\n'),
          html: mensajes.map((m) => `<p>${escapar(m)}</p>`).join(''),
        });
      } catch (err: any) {
        console.error(`Error al enviar la notificación por correo a ${email}:`, err.message);
      }
    }
  } finally {
    enviandoCorreos = false;
  }
};

export const iniciarNotificaciones = async () => {
  const correoConfigurado = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
  if (correoConfigurado) {
    try {
      const marca = await pool.query('SELECT COALESCE(MAX(id), 0) AS id FROM notificacion');
      ultimoIdEnviado = Number(marca.rows[0].id);
    } catch (err: any) {
      console.error('Error al preparar el envío de notificaciones por correo:', err.message);
    }
  } else {
    console.error('No se enviarán notificaciones por correo: faltan credenciales SMTP en server/.env.');
  }

  const ejecutar = async () => {
    try {
      await generarNotificaciones();
    } catch (err: any) {
      console.error('Error al generar notificaciones:', err.message);
    }
    if (!correoConfigurado) return;
    try {
      await enviarNotificacionesPorCorreo();
    } catch (err: any) {
      console.error('Error al enviar las notificaciones por correo:', err.message);
    }
  };
  void ejecutar();
  setInterval(() => void ejecutar(), INTERVALO_MS);
};