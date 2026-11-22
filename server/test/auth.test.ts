// Pruebas unitarias de autenticación: registro e inicio de sesión (RF01), familia e invitaciones (RF02–RF04),
// contraseñas con bcrypt (RNF01), sesiones (RNF05), aviso de privacidad (RNF31)
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { bd, errorBd } from './apoyo/bd-falsa';
import { levantar, silenciarErrores, type ServidorPrueba } from './apoyo/servidor';
import authRouter from '../src/modulos/auth/auth.routes';
import { verificarToken } from '../src/modulos/auth/auth.middleware';

const SECRETO = process.env.JWT_SECRET!;
const filaUsuario = (extra: Record<string, unknown> = {}) => ({
  id: 7,
  nombre: 'Ana',
  email: 'ana@ejemplo.com',
  rol_id: null,
  familia_id: null,
  perfil_completo: false,
  ...extra,
});

let servidor: ServidorPrueba;
before(async () => {
  servidor = await levantar(authRouter, { base: '/api/auth', autenticado: false });
});
after(() => servidor.cerrar());
beforeEach(() => {
  bd.reiniciar();
  bd.cuando('fn_iniciar_sesion', { rows: [{ version: 3 }] });
  bd.cuando('fn_validar_sesion', { rows: [{ ok: true }] });
});

describe('RF01 / RNF31: registro', () => {
  const nuevo = { nombre: 'Ana', email: 'ANA@Ejemplo.com', password: 'Segura123', acepta_aviso: true };

  it('crea la cuenta, devuelve token y guarda la contraseña con bcrypt (RNF01)', async () => {
    bd.cuando('SELECT 1 FROM usuario WHERE lower(email)', { rows: [] });
    bd.cuando('INSERT INTO usuario', (params) => ({ rows: [filaUsuario({ email: params[1] })] }));

    const r = await servidor.pedir('POST', '/api/auth/register', nuevo);
    assert.equal(r.estado, 201);
    assert.equal(r.cuerpo.user.email, 'ana@ejemplo.com', 'el correo se guarda en minúsculas');
    const datosToken = jwt.verify(r.cuerpo.token, SECRETO) as any;
    assert.deepEqual([datosToken.id, datosToken.v], [7, 3]);

    const [insert] = bd.buscar('INSERT INTO usuario');
    const hash = insert!.params[2];
    assert.notEqual(hash, nuevo.password, 'nunca se guarda en texto plano');
    assert.match(hash, /^\$2[aby]\$10\$/);
    assert.equal(await bcrypt.compare(nuevo.password, hash), true);
  });
  it('exige aceptar el aviso de privacidad (RNF31)', async () => {
    const r = await servidor.pedir('POST', '/api/auth/register', { ...nuevo, acepta_aviso: false });
    assert.equal(r.estado, 400);
    assert.match(r.cuerpo.error, /Aviso de privacidad/);
    assert.equal(bd.buscar('INSERT INTO usuario').length, 0);
  });
  it('indica qué campo está mal (RNF21)', async () => {
    const r = await servidor.pedir('POST', '/api/auth/register', { nombre: '', email: 'no-es-correo', password: '123', acepta_aviso: true });
    assert.equal(r.estado, 400);
    assert.equal(r.cuerpo.errores.length, 3);
    assert.match(r.cuerpo.error, /Nombre:.*Correo:.*Contraseña:/);
  });
  it('rechaza un correo ya registrado con 409', async () => {
    bd.cuando('SELECT 1 FROM usuario WHERE lower(email)', { rows: [{ '?column?': 1 }] });
    const r = await servidor.pedir('POST', '/api/auth/register', nuevo);
    assert.equal(r.estado, 409);
  });
});

describe('RF01: inicio de sesión', () => {
  let hash: string;
  before(async () => {
    hash = await bcrypt.hash('Segura123', 4);
  });

  it('con la contraseña correcta devuelve un token', async () => {
    bd.cuando('SELECT id, nombre, email, contrasena', { rows: [filaUsuario({ contrasena: hash, activo: true })] });
    const r = await servidor.pedir('POST', '/api/auth/login', { email: 'ana@ejemplo.com', password: 'Segura123' });
    assert.equal(r.estado, 200);
    assert.ok(r.cuerpo.token);
    assert.equal(r.cuerpo.user.contrasena, undefined, 'el hash nunca se envía al cliente');
  });
  it('con contraseña incorrecta, usuario inexistente o inactivo responde el mismo mensaje', async () => {
    bd.cuando('SELECT id, nombre, email, contrasena', { rows: [filaUsuario({ contrasena: hash, activo: true })] });
    const mala = await servidor.pedir('POST', '/api/auth/login', { email: 'ana@ejemplo.com', password: 'otra' });
    bd.cuando('SELECT id, nombre, email, contrasena', { rows: [] });
    const noExiste = await servidor.pedir('POST', '/api/auth/login', { email: 'x@ejemplo.com', password: 'Segura123' });
    bd.cuando('SELECT id, nombre, email, contrasena', { rows: [filaUsuario({ contrasena: hash, activo: false })] });
    const inactivo = await servidor.pedir('POST', '/api/auth/login', { email: 'ana@ejemplo.com', password: 'Segura123' });
    for (const r of [mala, noExiste, inactivo]) {
      assert.equal(r.estado, 400);
      assert.equal(r.cuerpo.error, 'Correo o contraseña incorrectos.');
    }
  });
  it('sin datos responde 400', async () => {
    const r = await servidor.pedir('POST', '/api/auth/login', {});
    assert.equal(r.estado, 400);
  });
});

describe('RNF05: sesiones', () => {
  const token = () => jwt.sign({ id: 7, v: 3 }, SECRETO);

  it('sin token responde 401', async () => {
    const r = await servidor.pedir('GET', '/api/auth/me');
    assert.equal(r.estado, 401);
  });
  it('un token falsificado o expirado responde 401', async () => {
    const falso = jwt.sign({ id: 7, v: 3 }, 'otro-secreto');
    const expirado = jwt.sign({ id: 7, v: 3, exp: Math.floor(Date.now() / 1000) - 10 }, SECRETO);
    for (const t of [falso, expirado, 'basura']) {
      const r = await servidor.pedir('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${t}` });
      assert.equal(r.estado, 401, t);
    }
  });
  it('si pasaron 30 minutos sin actividad (fn_validar_sesion = false) responde 401', async () => {
    bd.cuando('fn_validar_sesion', { rows: [{ ok: false }] });
    const r = await servidor.pedir('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${token()}` });
    assert.equal(r.estado, 401);
    assert.match(r.cuerpo.error, /inactividad/);
  });
  it('una sesión vigente devuelve el usuario y sus permisos', async () => {
    bd.cuando('SELECT id, nombre, email, rol_id', { rows: [filaUsuario({ rol_id: 1, familia_id: 10 })] });
    bd.cuando('fn_tiene_permiso($1::bigint, clave)', { rows: [{ clave: 'gastos.registrar' }, { clave: 'reportes.ver' }] });
    const r = await servidor.pedir('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${token()}` });
    assert.equal(r.estado, 200);
    assert.deepEqual(r.cuerpo.permisos, ['gastos.registrar', 'reportes.ver']);
    assert.equal(bd.buscar('fn_validar_sesion')[0]!.params[0], 7);
  });
  it('las consultas automáticas (x-famify-sondeo) no renuevan la actividad', async () => {
    bd.cuando("ultima_actividad > now() - interval '30 minutes'", { rows: [{ '?column?': 1 }] });
    bd.cuando('SELECT id, nombre, email, rol_id', { rows: [filaUsuario()] });
    bd.cuando('fn_tiene_permiso($1::bigint, clave)', { rows: [] });
    const r = await servidor.pedir('GET', '/api/auth/me', undefined, { Authorization: `Bearer ${token()}`, 'x-famify-sondeo': '1' });
    assert.equal(r.estado, 200);
    assert.equal(bd.buscar('fn_validar_sesion').length, 0);
  });
  it('cerrar sesión invalida el token (fn_cerrar_sesion)', async () => {
    bd.cuando('fn_cerrar_sesion', { rows: [{}] });
    const r = await servidor.pedir('POST', '/api/auth/logout', undefined, { Authorization: `Bearer ${token()}` });
    assert.equal(r.estado, 200);
    assert.equal(bd.buscar('fn_cerrar_sesion')[0]!.params[0], 7);
  });
  it('verificarToken solo acepta el esquema Bearer', async () => {
    let estado = 0;
    const res: any = { status: (s: number) => ((estado = s), res), json: () => res };
    await verificarToken({ headers: { authorization: `Basic ${token()}` } } as any, res, () => undefined);
    assert.equal(estado, 401);
  });
});

describe('RF02–RF04: familia e invitaciones (RNF06)', () => {
  const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: 7, v: 3 }, SECRETO)}` });

  it('RF02: crear familia la registra y genera un código de invitación en una transacción', async () => {
    bd.cuando('fn_crear_familia', { rows: [{ familia_id: 10 }] });
    bd.cuando('fn_crear_invitacion', { rows: [{ codigo_invitacion: 'ABC123' }] });
    const r = await servidor.pedir('POST', '/api/auth/crear-familia', { nombre_familia: 'Los Pérez' }, auth());
    assert.equal(r.estado, 200);
    assert.deepEqual(r.cuerpo.familia, { id: 10, nombre: 'Los Pérez', codigo_invitacion: 'ABC123' });
    assert.deepEqual(bd.transacciones(), ['BEGIN', 'COMMIT']);
  });
  it('RF02: si falla la invitación se revierte la familia (RNF15)', async () => {
    bd.cuando('fn_crear_familia', { rows: [{ familia_id: 10 }] });
    bd.cuando('fn_crear_invitacion', errorBd('XX000'));
    const restaurar = silenciarErrores();
    const r = await servidor.pedir('POST', '/api/auth/crear-familia', { nombre_familia: 'Los Pérez' }, auth());
    restaurar();
    assert.equal(r.estado, 500);
    assert.deepEqual(bd.transacciones(), ['BEGIN', 'ROLLBACK']);
  });
  it('RF02: el nombre de la familia es obligatorio', async () => {
    const r = await servidor.pedir('POST', '/api/auth/crear-familia', { nombre_familia: ' ' }, auth());
    assert.equal(r.estado, 400);
  });
  it('RF03: genera invitaciones solo con rol administrador (1) o integrante (2)', async () => {
    const malo = await servidor.pedir('POST', '/api/auth/generar-invitacion', { rol_id: 9 }, auth());
    assert.equal(malo.estado, 400);

    bd.cuando('SELECT familia_id FROM usuario', { rows: [{ familia_id: 10 }] });
    bd.cuando("lower(nombre) = 'integrante'", { rows: [] });
    bd.cuando('fn_crear_invitacion', { rows: [{ codigo_invitacion: 'XYZ789' }] });
    const ok = await servidor.pedir('POST', '/api/auth/generar-invitacion', { rol_id: 2 }, auth());
    assert.equal(ok.estado, 200);
    assert.equal(ok.cuerpo.codigo_invitacion, 'XYZ789');
    assert.match(ok.cuerpo.message, /48 horas/);
    assert.match(ok.cuerpo.enlace, /\?codigo=XYZ789$/);
  });
  it('RF04: unirse con un código válido', async () => {
    bd.cuando('fn_usar_invitacion', { rows: [{ familia_id: 10 }] });
    bd.cuando('SELECT id, nombre FROM familia', { rows: [{ id: 10, nombre: 'Los Pérez' }] });
    bd.cuando('SELECT rol_id FROM usuario', { rows: [{ rol_id: 2 }] });
    const r = await servidor.pedir('POST', '/api/auth/unirse-familia', { codigo_invitacion: 'XYZ789' }, auth());
    assert.equal(r.estado, 200);
    assert.equal(r.cuerpo.rol_id, 2);
  });
  it('RNF06: un código usado o vencido se rechaza con el mensaje de la base', async () => {
    bd.cuando('fn_usar_invitacion', errorBd('P0001', 'La invitación ya fue usada o expiró.'));
    const restaurar = silenciarErrores();
    const r = await servidor.pedir('POST', '/api/auth/unirse-familia', { codigo_invitacion: 'VIEJO' }, auth());
    restaurar();
    assert.equal(r.estado, 400);
    assert.equal(r.cuerpo.error, 'La invitación ya fue usada o expiró.');
  });
});
