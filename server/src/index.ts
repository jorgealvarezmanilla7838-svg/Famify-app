import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import type { PoolClient } from 'pg';
import { pool } from './db';
import gastosRouter from './modulos/gastos/gastos.routes';
import ingresosRouter from './modulos/ingresos/ingresos.routes';
import configuracionRouter from './modulos/configuracion/configuracion.routes';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Falta configurar JWT_SECRET en server/.env.');
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify((error) => {
  if (error) {
    console.error('Error al conectar con el servicio de correo:', error.message);
  } else {
    console.log('Servidor de correo listo para enviar mensajes.');
  }
});

app.use(cors());
app.use(express.json());

interface TokenUsuario extends JwtPayload {
  id: number;
}

interface AuthRequest extends Request {
  user?: TokenUsuario;
}

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

const crearToken = (usuario: UsuarioPublico) =>
  jwt.sign(
    {
      id: usuario.id,
      email: usuario.email,
      rol_id: usuario.rol_id,
      familia_id: usuario.familia_id,
    },
    JWT_SECRET,
    { expiresIn: '30m' }
  );

const verificarToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const [tipo, token] = (req.headers.authorization ?? '').split(' ');
  if (tipo?.toLowerCase() !== 'bearer' || !token) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
  }

  try {
    const verificado = jwt.verify(token, JWT_SECRET);
    if (typeof verificado === 'string' || typeof verificado.id !== 'number') {
      return res.status(403).json({ error: 'Token inválido. Inicia sesión nuevamente.' });
    }
    req.user = verificado as TokenUsuario;
    return next();
  } catch {
    return res.status(403).json({ error: 'Sesión expirada o token inválido. Inicia sesión nuevamente.' });
  }
};

const errorAuth = (res: Response, err: any, accion: string) => {
  console.error(`Error al ${accion}:`, err.message);
  if (err.code === '23505') {
    return res.status(409).json({ error: 'El correo electrónico ya está registrado.' });
  }
  if (err.code === '23514' || err.code === '23503' || err.code === 'P0001') {
    return res.status(400).json({ error: err.message || 'Los datos no cumplen las reglas del sistema.' });
  }
  return res.status(500).json({ error: 'Ocurrió un problema en el servidor. Intenta de nuevo.' });
};

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'Servidor de Famify corriendo correctamente.',
    timestamp: new Date().toISOString(),
  });
});

app.post('/api/auth/register', async (req: Request, res: Response) => {
  const nombre = typeof req.body?.nombre === 'string' ? req.body.nombre.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios.' });
  }
  if (nombre.length > 100 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'El nombre o el correo electrónico no tienen un formato válido.' });
  }
  if (password.length > 72) {
    return res.status(400).json({ error: 'La contraseña no puede superar 72 caracteres.' });
  }

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
      token: crearToken(usuario),
      user: usuario,
    });
  } catch (err: any) {
    return errorAuth(res, err, 'registrar el usuario');
  }
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos.' });
  }

  try {
    const resultado = await pool.query(
      `SELECT id, nombre, email, password_hash, rol_id, familia_id, perfil_completo, activo
         FROM usuarios WHERE lower(email) = lower($1)`,
      [email]
    );
    if (resultado.rows.length === 0 || !resultado.rows[0].activo) {
      return res.status(400).json({ error: 'Credenciales inválidas.' });
    }

    const fila = resultado.rows[0];
    if (!(await bcrypt.compare(password, fila.password_hash))) {
      return res.status(400).json({ error: 'Credenciales inválidas.' });
    }

    const usuario = usuarioPublico(fila);
    return res.json({
      success: true,
      message: 'Inicio de sesión exitoso.',
      token: crearToken(usuario),
      user: usuario,
    });
  } catch (err: any) {
    return errorAuth(res, err, 'iniciar sesión');
  }
});

app.post('/api/auth/crear-familia', verificarToken, async (req: AuthRequest, res: Response) => {
  const nombreFamilia = typeof req.body?.nombre_familia === 'string' ? req.body.nombre_familia.trim() : '';
  if (!nombreFamilia || nombreFamilia.length > 100) {
    return res.status(400).json({ error: 'El nombre de la familia es obligatorio y no puede pasar de 100 caracteres.' });
  }

  let cliente: PoolClient;
  try {
    cliente = await pool.connect();
  } catch (err: any) {
    return errorAuth(res, err, 'conectar para crear la familia');
  }

  let transaccionIniciada = false;
  try {
    await cliente.query('BEGIN');
    transaccionIniciada = true;
    const creada = await cliente.query('SELECT fn_crear_familia($1::bigint, $2::text) AS familia_id', [
      req.user!.id,
      nombreFamilia,
    ]);
    const familiaId = creada.rows[0].familia_id;
    const invitacion = await cliente.query(
      'SELECT fn_crear_invitacion($1::bigint, $2::smallint, NULL::text) AS codigo_invitacion',
      [req.user!.id, 2]
    );
    await cliente.query('COMMIT');
    transaccionIniciada = false;
    return res.json({
      success: true,
      message: 'Familia creada con éxito.',
      familia: {
        id: familiaId,
        nombre: nombreFamilia,
        codigo_invitacion: invitacion.rows[0].codigo_invitacion,
      },
    });
  } catch (err: any) {
    if (transaccionIniciada) {
      try {
        await cliente.query('ROLLBACK');
      } catch (rollbackError: any) {
        console.error('Error al revertir la creación de la familia:', rollbackError.message);
      }
    }
    return errorAuth(res, err, 'crear la familia');
  } finally {
    cliente.release();
  }
});

app.post('/api/auth/generar-invitacion', verificarToken, async (req: AuthRequest, res: Response) => {
  const rolId = Number(req.body?.rol_id);
  const emailInvitado =
    typeof req.body?.email_invitado === 'string' ? req.body.email_invitado.trim().toLowerCase() : '';
  if (![1, 2].includes(rolId)) {
    return res.status(400).json({ error: 'Selecciona un rol válido para la invitación.' });
  }
  if (emailInvitado && (emailInvitado.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInvitado))) {
    return res.status(400).json({ error: 'El correo del invitado no es válido.' });
  }

  try {
    const resultado = await pool.query(
      'SELECT fn_crear_invitacion($1::bigint, $2::smallint, $3::text) AS codigo_invitacion',
      [req.user!.id, rolId, emailInvitado || null]
    );
    const codigoInvitacion = resultado.rows[0].codigo_invitacion as string;
    const enlaceUnirse = `http://localhost:5173/?codigo=${encodeURIComponent(codigoInvitacion)}`;
    let mensaje = 'Invitación generada con éxito (válida por 48 horas).';

    if (emailInvitado) {
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        console.error('No se puede enviar la invitación: faltan credenciales SMTP en server/.env.');
        mensaje = 'Invitación generada, pero el correo no está configurado. Puedes copiar el código manualmente.';
      } else {
        try {
          await transporter.sendMail({
            from: `"Famify" <${process.env.SMTP_USER}>`,
            to: emailInvitado,
            subject: 'Invitación para unirte a una familia en Famify',
            text: `Te invitaron a Famify. Regístrate en ${enlaceUnirse} e ingresa el código ${codigoInvitacion}.`,
            html: `<p>Te invitaron a Famify.</p><p><a href="${enlaceUnirse}">Regístrate y únete</a></p><p>Código: <strong>${codigoInvitacion}</strong></p><p>El enlace expira en 48 horas.</p>`,
          });
          mensaje = 'Invitación generada y enviada por correo.';
        } catch (mailErr: any) {
          console.error('Error al enviar la invitación:', mailErr.message);
          mensaje = 'Invitación generada, pero no se pudo enviar el correo. Puedes copiar el código manualmente.';
        }
      }
    }

    return res.json({
      success: true,
      message: mensaje,
      codigo_invitacion: codigoInvitacion,
      enlace: enlaceUnirse,
    });
  } catch (err: any) {
    return errorAuth(res, err, 'generar la invitación');
  }
});

app.post('/api/auth/unirse-familia', verificarToken, async (req: AuthRequest, res: Response) => {
  const codigo = typeof req.body?.codigo_invitacion === 'string' ? req.body.codigo_invitacion.trim() : '';
  if (!codigo) {
    return res.status(400).json({ error: 'El código de invitación es obligatorio.' });
  }

  try {
    const resultado = await pool.query('SELECT fn_usar_invitacion($1::text, $2::bigint) AS familia_id', [
      codigo,
      req.user!.id,
    ]);
    const familiaId = resultado.rows[0].familia_id;
    const [familia, usuario] = await Promise.all([
      pool.query('SELECT id, nombre FROM familias WHERE id = $1::bigint', [familiaId]),
      pool.query('SELECT rol_id FROM usuarios WHERE id = $1::bigint', [req.user!.id]),
    ]);
    if (familia.rows.length === 0 || usuario.rows.length === 0) {
      return res.status(500).json({ error: 'No se pudo confirmar la familia después de aceptar la invitación.' });
    }
    return res.json({
      success: true,
      message: 'Te has unido a la familia correctamente.',
      familia: familia.rows[0],
      rol_id: usuario.rows[0].rol_id,
    });
  } catch (err: any) {
    return errorAuth(res, err, 'unirse a la familia');
  }
});

app.get('/api/auth/estado-familia/:familia_id', verificarToken, async (req: AuthRequest, res: Response) => {
  const parametroFamilia = typeof req.params.familia_id === 'string' ? req.params.familia_id : '';
  const familiaId = /^\d+$/.test(parametroFamilia) ? Number(parametroFamilia) : 0;
  if (!familiaId) {
    return res.status(400).json({ error: 'El id de la familia no es válido.' });
  }

  try {
    const usuario = await pool.query(
      'SELECT familia_id FROM usuarios WHERE id = $1::bigint AND activo',
      [req.user!.id]
    );
    if (!usuario.rows[0]?.familia_id || Number(usuario.rows[0].familia_id) !== familiaId) {
      return res.status(403).json({ error: 'No perteneces a la familia indicada.' });
    }

    const [familia, miembros] = await Promise.all([
      pool.query('SELECT id, nombre, created_at FROM familias WHERE id = $1::bigint', [familiaId]),
      pool.query(
        `SELECT u.id, u.nombre, u.email, r.nombre AS rol, u.created_at
           FROM usuarios u
           JOIN roles r ON r.id = u.rol_id
          WHERE u.familia_id = $1::bigint AND u.activo
          ORDER BY u.rol_id ASC, u.nombre ASC`,
        [familiaId]
      ),
    ]);
    if (familia.rows.length === 0) {
      return res.status(404).json({ error: 'Familia no encontrada.' });
    }
    return res.json({
      success: true,
      familia: familia.rows[0],
      total_miembros: miembros.rows.length,
      miembros: miembros.rows,
    });
  } catch (err: any) {
    return errorAuth(res, err, 'consultar el estado de la familia');
  }
});

app.use('/api/configuracion', verificarToken, configuracionRouter);
app.use('/api/gastos', verificarToken, gastosRouter);
app.use('/api/ingresos', verificarToken, ingresosRouter);

app.listen(PORT, () => {
  console.log(`Servidor Famify iniciado en http://localhost:${PORT}`);
});
