import nodemailer from 'nodemailer';
import { pool } from '../../db';

// RF22_ Alerta de límite de presupuesto por correo
// La base de datos (fn_verificar_presupuesto) decide cuándo hay alerta y la guarda en
// la tabla notificacion sin repetirla. Aquí solo se mandan por Gmail las que son nuevas.

const escapar = (texto: string) =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// RF22_ Manda el correo a cada integrante de la familia con las alertas nuevas
export const enviarAlertasPresupuesto = async (familiaId: number, desde: Date) => {
  try {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('No se pueden enviar alertas de presupuesto: faltan credenciales SMTP en server/.env.');
      return;
    }

    const nuevas = await pool.query(
      `SELECT u.email, n.mensaje
         FROM notificacion n
         JOIN usuario u ON u.id = n.usuario_id
        WHERE u.familia_id = $1::bigint AND u.activo
          AND n.tipo = 'presupuesto'
          AND n.fecha >= $2::timestamptz
        ORDER BY n.id`,
      [familiaId, desde]
    );
    if (nuevas.rows.length === 0) return;

    // un solo correo por integrante aunque tenga varias alertas
    const porCorreo = new Map<string, string[]>();
    for (const fila of nuevas.rows) {
      const lista = porCorreo.get(fila.email) ?? [];
      lista.push(fila.mensaje);
      porCorreo.set(fila.email, lista);
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    for (const [correo, mensajes] of porCorreo) {
      try {
        await transporter.sendMail({
          from: `"Famify" <${process.env.SMTP_USER}>`,
          to: correo,
          subject: 'Alerta de presupuesto familiar - Famify',
          text: `Alerta de presupuesto:\n\n${mensajes.join('\n')}\n\nEntra a Famify > Presupuesto familiar para ver el detalle.`,
          html: `<p><strong>Alerta de presupuesto familiar</strong></p>
                 <ul>${mensajes.map((m) => `<li>${escapar(m)}</li>`).join('')}</ul>
                 <p>Entra a Famify &gt; Presupuesto familiar para ver el detalle.</p>`,
        });
      } catch (err: any) {
        console.error(`Error al enviar la alerta de presupuesto a ${correo}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('Error al revisar las alertas de presupuesto:', err.message);
  }
};

// RF22_ Revisa los límites con la función de la BD y manda los correos nuevos
// Se usa cuando se guarda o cambia un presupuesto (con los gastos ya lo hace el trigger de la BD)
export const revisarPresupuestoYAvisar = async (familiaId: number) => {
  const desde = new Date(Date.now() - 1000);
  try {
    await pool.query('SELECT fn_verificar_presupuesto($1::bigint, current_date)', [familiaId]);
  } catch (err: any) {
    console.error('Error al verificar el presupuesto:', err.message);
    return;
  }
  await enviarAlertasPresupuesto(familiaId, desde);
};
