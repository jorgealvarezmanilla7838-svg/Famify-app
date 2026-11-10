import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { enTransaccion, pool } from '../../db';
import { responderError, textoRecortado } from '../compartido/errores';
import { type AuthRequest, secretoJwt, verificarToken } from './auth.middleware';

const router = Router();

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

export const urlCliente = () => (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0]!.trim();

interface UsuarioPublico {
  id: number;
  nombre: string;
  email: string;
  rol_id: number | null;
  familia_id: number | null;
  perfil_completo: boolean;
}

const usuarioPublico = (fila: any): UsuarioPublico => ({
  id: Number(fila.id),
  nombre: fila.nombre,
  email: fila.email,
  rol_id: fila.rol_id === null ? null : Number(fila.rol_id),
  familia_id: fila.familia_id === null ? null : Number(fila.familia_id),
  perfil_completo: Boolean(fila.perfil_completo),
});

// RNF05_ Cada inicio de sesión abre una sesión propia que se puede invalidar.
// Los 30 minutos de inactividad se controlan en verificarToken.
const abrirSesion = async (usuario: UsuarioPublico) => {
  const sesion = await pool.query('INSERT INTO sesiones (usuario_id) VALUES ($1::bigint) RETURNING id', [usuario.id]);
  return jwt.sign({ id: usuario.id, sid: sesion.rows[0].id }, secretoJwt(), { expiresIn: '12h' });
};

// RF01_ Registro. RNF31_ exige aceptar el aviso de privacidad. RNF01_ guarda solo el hash.
router.post('/register', async (req: Request, res: Response) => {
  const nombre = textoRecortado(req.body?.nombre);
  const email = textoRecortado(req.body?.email).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  const errores: string[] = [];
  if (!nombre || nombre.length > 100) errores.push('Nombre: es obligatorio y admite hasta 100 caracteres.');
  if (!CORREO_VALIDO.test(email) || email.length > 254) errores.push('Correo: escribe un correo válido, como nombre@ejemplo.com.');
  if (password.length < 8 || password.length > 72) errores.push('Contraseña: debe tener entre 8 y 72 caracteres.');
  if (req.body?.acepta_aviso !== true) errores.push('Aviso de privacidad: debes aceptarlo para crear tu cuenta.');
  if (errores.length > 0) return res.status(400).json({ error: errores.join(' '), errores });

  try {
    const existente = await pool.query('SELECT 1 FROM usuarios WHERE lower(email) = lower($1)', [email]);
    if (existente.rows.length > 0) {
      return res.status(409).json({ error: 'El correo electrónico ya está registrado.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const resultado = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, aviso_privacidad_aceptado_en)
       VALUES ($1::varchar, $2::varchar, $3::varchar, now())
       RETURNING id, nombre, email, rol_id, familia_id, perfil_completo`,
      [nombre, email, passwordHash]
    );
    const usuario = usuarioPublico(resultado.rows[0]);
    return res.status(201).json({
      success: true,
      message: 'Usuario registrado con éxito.',
      token: await abrirSesion(usuario),
      user: usuario,
    });
  } catch (err: any) {
    return responderError(res, err, 'registrar el usuario');
  }
});

// RF01_ Inicio de sesión
router.post('/login', async (req: Request, res: Response) => {
  const email = textoRecortado(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Escribe tu correo y tu contraseña.' });
  }

  try {
    const resultado = await pool.query(
      `SELECT id, nombre, email, password_hash, rol_id, familia_id, perfil_completo, activo
         FROM usuarios WHERE lower(email) = lower($1)`,
      [email]
    );
    const fila = resultado.rows[0];
    if (!fila || !fila.activo || !(await bcrypt.compare(password, fila.password_hash))) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });
    }
    const usuario = usuarioPublico(fila);
    return res.json({
      success: true,
      message: 'Inicio de sesión exitoso.',
      token: await abrirSesion(usuario),
      user: usuario,
    });
  } catch (err: any) {
    return responderError(res, err, 'iniciar sesión');
  }
});

// Permite recuperar la sesión al recargar la página y conocer los permisos actuales
router.get('/me', verificarToken, async (req: AuthRequest, res: Response) => {
  try {
    const [usuario, permisos] = await Promise.all([
      pool.query(
        `SELECT id, nombre, email, rol_id, familia_id, perfil_completo
           FROM usuarios WHERE id = $1::bigint AND activo`,
        [req.user!.id]
      ),
      pool.query('SELECT clave FROM permisos WHERE fn_tiene_permiso($1::bigint, clave)', [req.user!.id]),
    ]);
    if (usuario.rows.length === 0) return res.status(401).json({ error: 'Usuario no válido.' });
    return res.json({
      success: true,
      user: usuarioPublico(usuario.rows[0]),
      permisos: permisos.rows.map((p: any) => p.clave),
    });
  } catch (err: any) {
    return responderError(res, err, 'consultar la sesión');
  }
});

// RNF05_ Al cerrar sesión el token deja de servir de inmediato
router.post('/logout', verificarToken, async (req: AuthRequest, res: Response) => {
  try {
    await pool.query('UPDATE sesiones SET cerrada_en = now() WHERE id = $1::uuid', [req.user!.sid]);
    return res.json({ success: true, message: 'Sesión cerrada correctamente.' });
  } catch (err: any) {
    return responderError(res, err, 'cerrar la sesión');
  }
});

// RF02_ Creación de familia
router.post('/crear-familia', verificarToken, async (req: AuthRequest, res: Response) => {
  const nombreFamilia = textoRecortado(req.body?.nombre_familia);
  if (!nombreFamilia || nombreFamilia.length > 100) {
    return res.status(400).json({ error: 'Nombre de la familia: es obligatorio y admite hasta 100 caracteres.' });
  }

  try {
    const familia = await enTransaccion(async (cliente) => {
      const creada = await cliente.query('SELECT fn_crear_familia($1::bigint, $2::text) AS familia_id', [
        req.user!.id,
        nombreFamilia,
      ]);
      const invitacion = await cliente.query(
        'SELECT fn_crear_invitacion($1::bigint, $2::smallint, NULL::text) AS codigo_invitacion',
        [req.user!.id, 2]
      );
      return {
        id: creada.rows[0].familia_id,
        nombre: nombreFamilia,
        codigo_invitacion: invitacion.rows[0].codigo_invitacion,
      };
    });
    return res.json({ success: true, message: 'Familia creada con éxito.', familia });
  } catch (err: any) {
    return responderError(res, err, 'crear la familia');
  }
});

// RF03_ Invitaciones con rol. RNF06_ caducan a las 48 horas y son de un solo uso.
router.post('/generar-invitacion', verificarToken, async (req: AuthRequest, res: Response) => {
  const rolId = Number(req.body?.rol_id);
  const emailInvitado = textoRecortado(req.body?.email_invitado).toLowerCase();
  if (![1, 2].includes(rolId)) {
    return res.status(400).json({ error: 'Rol: selecciona un rol válido para la invitación.' });
  }
  if (emailInvitado && (emailInvitado.length > 254 || !CORREO_VALIDO.test(emailInvitado))) {
    return res.status(400).json({ error: 'Correo del invitado: escribe un correo válido.' });
  }

  try {
    const resultado = await pool.query(
      'SELECT fn_crear_invitacion($1::bigint, $2::smallint, $3::text) AS codigo_invitacion',
      [req.user!.id, rolId, emailInvitado || null]
    );
    const codigo = resultado.rows[0].codigo_invitacion as string;
    const enlace = `${urlCliente()}/?codigo=${encodeURIComponent(codigo)}`;
    let mensaje = 'Invitación generada con éxito (válida por 48 horas).';

    if (emailInvitado) {
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.error('No se puede enviar la invitación: faltan credenciales SMTP en server/.env.');
        mensaje = 'Invitación generada, pero el correo no está configurado. Comparte el código manualmente.';
      } else {
        try {
          await transporter.sendMail({
            from: `"Famify" <${process.env.SMTP_USER}>`,
            to: emailInvitado,
            subject: 'Invitación para unirte a una familia en Famify',
            text: `Te invitaron a Famify. Regístrate en ${enlace} e ingresa el código ${codigo}. Expira en 48 horas.`,
            html: `<p>Te invitaron a Famify.</p><p><a href="${enlace}">Regístrate y únete</a></p><p>Código: <strong>${codigo}</strong></p><p>El enlace expira en 48 horas.</p>`,
          });
          mensaje = 'Invitación generada y enviada por correo.';
        } catch (errorCorreo: any) {
          console.error('Error al enviar la invitación:', errorCorreo.message);
          mensaje = 'Invitación generada, pero no se pudo enviar el correo. Comparte el código manualmente.';
        }
      }
    }
    return res.json({ success: true, message: mensaje, codigo_invitacion: codigo, enlace });
  } catch (err: any) {
    return responderError(res, err, 'generar la invitación');
  }
});

// RF04_ Unirse a una familia con invitación
router.post('/unirse-familia', verificarToken, async (req: AuthRequest, res: Response) => {
  const codigo = textoRecortado(req.body?.codigo_invitacion);
  if (!codigo) {
    return res.status(400).json({ error: 'Código de invitación: es obligatorio.' });
  }

  try {
    const resultado = await pool.query('SELECT fn_usar_invitacion($1::text, $2::bigint) AS familia_id', [
      codigo,
      req.user!.id,
    ]);
    const [familia, usuario] = await Promise.all([
      pool.query('SELECT id, nombre FROM familias WHERE id = $1::bigint', [resultado.rows[0].familia_id]),
      pool.query('SELECT rol_id FROM usuarios WHERE id = $1::bigint', [req.user!.id]),
    ]);
    return res.json({
      success: true,
      message: 'Te has unido a la familia correctamente.',
      familia: familia.rows[0],
      rol_id: usuario.rows[0].rol_id,
    });
  } catch (err: any) {
    return responderError(res, err, 'unirse a la familia');
  }
});

export default router;
