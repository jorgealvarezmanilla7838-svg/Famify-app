import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { pool } from './db';
import gastosRouter from './modulos/gastos/gastos.routes';
import configuracionRouter from './modulos/configuracion/configuracion.routes';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'famify_secret_key_local';

// Transportador de Nodemailer (Gmail)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify((error) => {
  if (error) {
    console.error('❌ Error al conectar con Gmail (Nodemailer):', error.message);
  } else {
    console.log('📧 Servidor de correo listo para enviar mensajes.');
  }
});

app.use(cors());
app.use(express.json());

// RNF03 & RNF05: Middleware para verificar token JWT y sesión activa
interface AuthRequest extends Request {
  user?: any;
}

const verificarToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const tokenHeader = req.headers['authorization'];
  const token = tokenHeader && tokenHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. Token no proporcionado.' });
  }

  try {
    const verificado = jwt.verify(token, JWT_SECRET);
    req.user = verificado;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Sesión expirada o token inválido. Inicia sesión nuevamente.' });
  }
};

// Health Check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'Servidor de Famify corriendo correctamente 🚀',
    timestamp: new Date().toISOString(),
  });
});

// RF01: Registro de usuario (RNF01 & RNF08)
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { nombre, email, password } = req.body;

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios.' });
  }

  try {
    const userCheck = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, aviso_privacidad_aceptado_en) 
       VALUES ($1, $2, $3, NOW()) 
       RETURNING id, nombre, email, rol_id, familia_id, perfil_completo`,
      [nombre, email, passwordHash]
    );

    // RNF05: Token con caducidad de 30 minutos de inactividad
    const token = jwt.sign(
      { id: newUser.rows[0].id, email: newUser.rows[0].email, rol_id: newUser.rows[0].rol_id, familia_id: newUser.rows[0].familia_id },
      JWT_SECRET,
      { expiresIn: '30m' }
    );

    return res.status(201).json({
      success: true,
      message: 'Usuario registrado con éxito.',
      token,
      user: newUser.rows[0],
    });
  } catch (err: any) {
    console.error('❌ Error en /register:', err);
    return res.status(500).json({ error: `Error en Postgres: ${err.message}` });
  }
});

// RF01: Inicio de sesión (RNF01 & RNF05)
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos.' });
  }

  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Credenciales inválidas.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Credenciales inválidas.' });
    }

    // RNF05: Token expira tras 30 minutos de inactividad
    const token = jwt.sign(
      { id: user.id, email: user.email, rol_id: user.rol_id, familia_id: user.familia_id },
      JWT_SECRET,
      { expiresIn: '30m' }
    );

    return res.json({
      success: true,
      message: 'Inicio de sesión exitoso.',
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        rol_id: user.rol_id,
        familia_id: user.familia_id,
        perfil_completo: user.perfil_completo,
      },
    });
  } catch (err: any) {
    console.error('❌ Error en /login:', err);
    return res.status(500).json({ error: `Error en Postgres: ${err.message}` });
  }
});

// RF02: Creación de familia
app.post('/api/auth/crear-familia', verificarToken, async (req: AuthRequest, res: Response) => {
  const { usuario_id, nombre_familia } = req.body;

  if (!usuario_id || !nombre_familia) {
    return res.status(400).json({ error: 'Usuario y nombre de familia requeridos.' });
  }

  try {
    const resultFam = await pool.query('SELECT fn_crear_familia($1, $2) AS familia_id', [
      usuario_id,
      nombre_familia,
    ]);
    const familiaId = resultFam.rows[0].familia_id;

const resultInv = await pool.query(
  'SELECT fn_crear_invitacion($1, $2, $3) AS codigo_invitacion',
  [usuario_id, 2, null]
);
    const codigoInvitacion = resultInv.rows[0].codigo_invitacion;

    return res.json({
      success: true,
      message: 'Familia creada con éxito.',
      familia: {
        id: familiaId,
        nombre: nombre_familia,
        codigo_invitacion: codigoInvitacion,
      },
    });
  } catch (err: any) {
    console.error('❌ Error en /crear-familia:', err);
    return res.status(500).json({ error: `Error en Postgres: ${err.message}` });
  }
});

// RF03: Generar invitación (RNF03: Control de acceso por rol & RNF06: Seguridad de invitación)
app.post('/api/auth/generar-invitacion', verificarToken, async (req: AuthRequest, res: Response) => {
  const { usuario_id, rol_id, email_invitado } = req.body;

  if (!usuario_id || !rol_id) {
    return res.status(400).json({ error: 'Usuario y rol son obligatorios.' });
  }

  try {
    // RNF03: Validación estricta del Rol de Administrador
    const userResult = await pool.query('SELECT rol_id FROM usuarios WHERE id = $1', [usuario_id]);
    if (userResult.rows.length === 0 || Number(userResult.rows[0].rol_id) !== 1) {
      return res.status(403).json({
        error: 'Acceso denegado: Solo el Administrador de la familia puede generar invitaciones.',
      });
    }

    const result = await pool.query(
      'SELECT fn_crear_invitacion($1, $2, $3) AS codigo_invitacion',
      [usuario_id, rol_id, email_invitado || null]
    );

    const codigoInvitacion = result.rows[0].codigo_invitacion;
    const enlaceUnirse = `http://localhost:5173/?codigo=${codigoInvitacion}`;
    let mensajeEnvio = 'Invitación generada con éxito (válida por 48 horas).';

    if (email_invitado) {
      try {
        await transporter.sendMail({
          from: `"Famify" <${process.env.SMTP_USER || 'jaamanillah@gmail.com'}>`,
          to: email_invitado.trim(),
          subject: '¡Has sido invitado a unirte a una familia en Famify!',
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 500px; border: 1px solid #e0e0e0; border-radius: 8px;">
              <h2 style="color: #2c3e50;">¡Hola!</h2>
              <p>Has sido invitado a formar parte de un grupo familiar en <strong>Famify</strong>.</p>
              <p>Haz clic en el siguiente botón para registrarte y unirte automáticamente:</p>
              <div style="text-align: center; margin: 25px 0;">
                <a href="${enlaceUnirse}" style="background-color: #3498db; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Aceptar Invitación y Unirme
                </a>
              </div>
              <p style="font-size: 0.85em; color: #777;">O bien, copia y pega el código manualmente: <code>${codigoInvitacion}</code></p>
              <p style="font-size: 0.8em; color: #aaa;">Este enlace expira en 48 horas.</p>
            </div>
          `,
        });
        mensajeEnvio = `Invitación generada y enviada con éxito a ${email_invitado}.`;
      } catch (mailErr: any) {
        console.error('❌ Error al enviar correo:', mailErr.message);
        mensajeEnvio = 'Invitación generada, pero ocurrió un detalle al enviar el correo. Puedes copiar el código manualmente.';
      }
    }

    return res.json({
      success: true,
      message: mensajeEnvio,
      codigo_invitacion: codigoInvitacion,
      enlace: enlaceUnirse,
    });
  } catch (err: any) {
    console.error('❌ Error en /generar-invitacion:', err);
    return res.status(500).json({ error: `Error en Postgres: ${err.message}` });
  }
});

// RF04: Unirse a una familia
app.post('/api/auth/unirse-familia', verificarToken, async (req: AuthRequest, res: Response) => {
  const { usuario_id, codigo_invitacion } = req.body;

  if (!usuario_id || !codigo_invitacion) {
    return res.status(400).json({ error: 'Usuario y código de invitación requeridos.' });
  }

  try {
    const result = await pool.query('SELECT fn_usar_invitacion($1, $2) AS familia_id', [
      codigo_invitacion.trim(),
      usuario_id,
    ]);

    const familiaId = result.rows[0].familia_id;
    const famQuery = await pool.query('SELECT nombre FROM familias WHERE id = $1', [familiaId]);

    return res.json({
      success: true,
      message: 'Te has unido a la familia correctamente.',
      familia: {
        id: familiaId,
        nombre: famQuery.rows[0]?.nombre || 'Familia',
      },
    });
  } catch (err: any) {
    console.error('❌ Error en /unirse-familia:', err);
    return res.status(500).json({ error: `Error en Postgres: ${err.message}` });
  }
});

// Estado de la familia (RNF04: Aislamiento de datos por familia)
app.get('/api/auth/estado-familia/:familia_id', verificarToken, async (req: AuthRequest, res: Response) => {
  const { familia_id } = req.params;

  // RNF04: Verificar que el usuario pertenezca a la familia que solicita consultar
  if (Number(req.user.familia_id) !== Number(familia_id)) {
    return res.status(403).json({ error: 'Acceso denegado: Aislamiento de datos por familia (RNF04).' });
  }

  try {
    const famQuery = await pool.query(
      'SELECT id, nombre, created_at FROM familias WHERE id = $1',
      [familia_id]
    );
    if (famQuery.rows.length === 0) {
      return res.status(404).json({ error: 'Familia no encontrada.' });
    }

    const miembrosQuery = await pool.query(
      `SELECT u.id, u.nombre, u.email, r.nombre AS rol, u.created_at
       FROM usuarios u
       JOIN roles r ON r.id = u.rol_id
       WHERE u.familia_id = $1 AND u.activo = true
       ORDER BY u.rol_id ASC, u.nombre ASC`,
      [familia_id]
    );

    return res.json({
      success: true,
      familia: famQuery.rows[0],
      total_miembros: miembrosQuery.rows.length,
      miembros: miembrosQuery.rows,
    });
  } catch (err: any) {
    console.error('❌ Error en /estado-familia:', err);
    return res.status(500).json({ error: `Error en Postgres: ${err.message}` });
  }
});

// Módulo 2: Configuración de usuario (RF05 a RF08), cuestionario para completar el registro
app.use('/api/configuracion', verificarToken, configuracionRouter);

// Módulo 2: Gestión de Gastos y Egresos (RF13 a RF18)
app.use('/api/gastos', verificarToken, gastosRouter);

app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`🚀 Servidor Famify iniciado en: http://localhost:${PORT}`);
  console.log(`🔒 Módulo de Seguridad y Autenticación Activo`);
  console.log(`=================================`);
});