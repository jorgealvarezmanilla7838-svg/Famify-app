// Pruebas unitarias de seguridad: sanitización (RNF08), cabeceras, HTTPS (RNF02), errores (RNF16)
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express, { Router } from 'express';
import { cabecerasSeguras, exigirHttps, medirTiempo, sanitizarEntrada } from '../src/modulos/compartido/seguridad';
import { ErrorNegocio, responderError } from '../src/modulos/compartido/errores';
import { levantar, silenciarErrores } from './apoyo/servidor';

// Respuesta falsa de Express para probar middlewares sin servidor
const respuestaFalsa = () => {
  const r: any = { estado: 200, cuerpo: undefined, cabeceras: {} as Record<string, string> };
  r.status = (s: number) => ((r.estado = s), r);
  r.json = (c: unknown) => ((r.cuerpo = c), r);
  r.setHeader = (k: string, v: string) => {
    r.cabeceras[k] = v;
  };
  return r;
};

describe('RNF08: sanitización de entradas (XSS)', () => {
  it('quita etiquetas HTML en textos, listas y objetos anidados', () => {
    const req: any = {
      body: {
        fuente: '<script>alert(1)</script>Trabajo',
        lista: ['<b>uno</b>', 2],
        anidado: { nombre: ' <img src=x onerror=alert(1)>Ana ' },
      },
    };
    let siguio = false;
    sanitizarEntrada(req, {} as any, () => {
      siguio = true;
    });
    assert.equal(siguio, true);
    assert.equal(req.body.fuente, 'alert(1)Trabajo');
    assert.deepEqual(req.body.lista, ['uno', 2]);
    assert.equal(req.body.anidado.nombre, 'Ana');
  });
  it('no modifica la contraseña (puede contener < y >)', () => {
    const req: any = { body: { password: ' <Clave>123 ' } };
    sanitizarEntrada(req, {} as any, () => undefined);
    assert.equal(req.body.password, ' <Clave>123 ');
  });
});

describe('Cabeceras de seguridad', () => {
  it('agrega nosniff, DENY y no-referrer', () => {
    const res = respuestaFalsa();
    cabecerasSeguras({} as any, res, () => undefined);
    assert.equal(res.cabeceras['X-Content-Type-Options'], 'nosniff');
    assert.equal(res.cabeceras['X-Frame-Options'], 'DENY');
    assert.equal(res.cabeceras['Referrer-Policy'], 'no-referrer');
  });
});

describe('RNF02: comunicación segura (HTTPS/TLS)', () => {
  const entornoOriginal = { ...process.env };
  afterEach(() => {
    process.env.NODE_ENV = entornoOriginal.NODE_ENV;
    delete process.env.TLS_OBLIGATORIO;
  });

  it('en una conexión HTTPS agrega HSTS y continúa', () => {
    const res = respuestaFalsa();
    let siguio = false;
    exigirHttps({ secure: true } as any, res, () => {
      siguio = true;
    });
    assert.equal(siguio, true);
    assert.match(res.cabeceras['Strict-Transport-Security'], /max-age=31536000/);
  });
  it('en desarrollo deja pasar HTTP sin HSTS', () => {
    const res = respuestaFalsa();
    let siguio = false;
    exigirHttps({ secure: false } as any, res, () => {
      siguio = true;
    });
    assert.equal(siguio, true);
    assert.equal(res.cabeceras['Strict-Transport-Security'], undefined);
  });
  it('en producción rechaza con 403 cualquier petición que no sea HTTPS', () => {
    process.env.NODE_ENV = 'production';
    const res = respuestaFalsa();
    let siguio = false;
    exigirHttps({ secure: false } as any, res, () => {
      siguio = true;
    });
    assert.equal(siguio, false);
    assert.equal(res.estado, 403);
    assert.match(res.cuerpo.error, /HTTPS/);
  });
  it('con TLS_OBLIGATORIO=true también rechaza HTTP', () => {
    process.env.TLS_OBLIGATORIO = 'true';
    const res = respuestaFalsa();
    exigirHttps({ secure: false } as any, res, () => undefined);
    assert.equal(res.estado, 403);
  });
});

describe('RNF09: cabecera Server-Timing', () => {
  it('cada respuesta indica cuánto tardó el servidor', async () => {
    const router = Router();
    router.get('/ping', (_req, res) => {
      res.json({ ok: true });
    });
    const app = express();
    app.use(medirTiempo);
    app.use(router);
    const servidor = await levantar(Router().use(app), { autenticado: false });
    try {
      const r = await servidor.pedir('GET', '/ping');
      assert.equal(r.estado, 200);
      assert.match(r.cabeceras.get('server-timing') ?? '', /^app;dur=\d+(\.\d)?$/);
    } finally {
      await servidor.cerrar();
    }
  });
});

describe('RNF16: errores claros sin detalles técnicos', () => {
  const casos: [string, number, RegExp][] = [
    ['42501', 403, /No tienes permiso/],
    ['23P01', 409, /traslapan/],
    ['23505', 409, /Ya existe/],
    ['23503', 400, /no cumplen las reglas/],
    ['23514', 400, /no cumplen las reglas/],
    ['XX000', 500, /problema en el servidor/],
  ];
  for (const [codigo, estado, mensaje] of casos) {
    it(`código ${codigo} de PostgreSQL responde ${estado}`, () => {
      const restaurar = silenciarErrores();
      const res = respuestaFalsa();
      responderError(res, Object.assign(new Error('detalle interno: tabla usuario columna x'), { code: codigo }), 'probar');
      restaurar();
      assert.equal(res.estado, estado);
      assert.match(res.cuerpo.error, mensaje);
      assert.doesNotMatch(res.cuerpo.error, /tabla usuario|columna/);
    });
  }
  it('los mensajes de reglas de negocio (P0001 y ErrorNegocio) sí llegan al usuario', () => {
    const restaurar = silenciarErrores();
    const r1 = respuestaFalsa();
    responderError(r1, Object.assign(new Error('La invitación ya expiró.'), { code: 'P0001' }), 'probar');
    const r2 = respuestaFalsa();
    responderError(r2, new ErrorNegocio(404, 'Meta no encontrada.'), 'probar');
    restaurar();
    assert.deepEqual([r1.estado, r1.cuerpo.error], [400, 'La invitación ya expiró.']);
    assert.deepEqual([r2.estado, r2.cuerpo.error], [404, 'Meta no encontrada.']);
  });
});
