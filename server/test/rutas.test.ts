// Pruebas unitarias de las rutas de cada módulo (con la base de datos simulada):
// aislamiento por familia (RNF04), control de acceso por rol (RNF03), validaciones (RNF21) y transacciones (RNF15)
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';
import { bd, errorBd, prepararUsuario } from './apoyo/bd-falsa';
import { levantar, silenciarErrores, type ServidorPrueba } from './apoyo/servidor';
import { fechaLocal } from '../src/modulos/gastos/gastos.validaciones';
import administracionRouter from '../src/modulos/administracion/administracion.routes';
import configuracionRouter from '../src/modulos/configuracion/configuracion.routes';
import gastosRouter from '../src/modulos/gastos/gastos.routes';
import ingresosRouter from '../src/modulos/ingresos/ingresos.routes';
import metasRouter from '../src/modulos/metas/metas.routes';
import notificacionesRouter from '../src/modulos/notificaciones/notificaciones.routes';
import presupuestoRouter from '../src/modulos/presupuesto/presupuesto.routes';
import reportesRouter from '../src/modulos/reportes/reportes.routes';

// Mismo montaje que server/src/index.ts (verificarToken se simula con un usuario fijo)
const api = Router();
api.use('/api/configuracion', configuracionRouter);
api.use('/api/gastos', gastosRouter);
api.use('/api/ingresos', ingresosRouter);
api.use('/api/presupuestos', presupuestoRouter);
api.use('/api/metas', metasRouter);
api.use('/api/reportes', reportesRouter);
api.use('/api/notificaciones', notificacionesRouter);
api.use('/api/administracion', administracionRouter);

let s: ServidorPrueba;
let restaurar: () => void;
before(async () => {
  s = await levantar(api);
  restaurar = silenciarErrores();
});
after(async () => {
  restaurar();
  await s.cerrar();
});
beforeEach(() => {
  bd.reiniciar();
  s.usuario.id = 1;
});

describe('RNF04: aislamiento por familia', () => {
  it('sin familia no se puede usar ningún módulo', async () => {
    prepararUsuario({ familia: null });
    for (const ruta of ['/api/gastos', '/api/ingresos', '/api/presupuestos', '/api/metas', '/api/reportes/resumen']) {
      const r = await s.pedir('GET', ruta);
      assert.equal(r.estado, 403, ruta);
      assert.match(r.cuerpo.error, /crear una familia/);
    }
  });
  it('un usuario inactivo o inexistente recibe 403', async () => {
    prepararUsuario({ activo: false });
    assert.equal((await s.pedir('GET', '/api/gastos')).estado, 403);
  });
  it('la familia y el usuario se toman de la base de datos, no del cuerpo de la petición', async () => {
    prepararUsuario({ id: 1, familia: 10 });
    bd.cuando('INSERT INTO gastos', { rows: [{ id: 1, monto: '10', fecha: '2026-11-21' }] });
    await s.pedir('POST', '/api/gastos', { monto: 10, categoria_id: 1, metodo_pago_id: 1, familia_id: 999, usuario_id: 999 });
    const [insert] = bd.buscar('INSERT INTO gastos');
    assert.deepEqual(insert!.params.slice(0, 2), [10, 1]);
  });
});

describe('RNF03: control de acceso por rol', () => {
  it('sin el permiso gastos.registrar responde 403 y no inserta', async () => {
    prepararUsuario({ admin: false, permisos: ['reportes.ver'] });
    const r = await s.pedir('POST', '/api/gastos', { monto: 10, categoria_id: 1, metodo_pago_id: 1 });
    assert.equal(r.estado, 403);
    assert.equal(bd.buscar('INSERT INTO gastos').length, 0);
  });
  it('sin reportes.ver no puede ver resumen ni reportes', async () => {
    prepararUsuario({ admin: false, permisos: ['gastos.registrar'] });
    for (const ruta of ['/api/reportes/resumen', '/api/reportes/familiar', '/api/gastos/por-categoria']) {
      assert.equal((await s.pedir('GET', ruta)).estado, 403, ruta);
    }
  });
  it('un integrante no puede modificar el gasto de otro integrante', async () => {
    prepararUsuario({ id: 5, admin: false });
    s.usuario.id = 5;
    bd.cuando('SELECT usuario_id FROM gastos', { rows: [{ usuario_id: 1 }] });
    const editar = await s.pedir('PUT', '/api/gastos/3', { monto: 10, categoria_id: 1, metodo_pago_id: 1 });
    const borrar = await s.pedir('DELETE', '/api/gastos/3');
    assert.deepEqual([editar.estado, borrar.estado], [403, 403]);
    assert.equal(bd.buscar('DELETE FROM gastos').length, 0);
  });
  it('las rutas de administración son solo para el administrador', async () => {
    prepararUsuario({ admin: false });
    const rutas: [string, string][] = [
      ['GET', '/api/administracion/integrantes'],
      ['PUT', '/api/administracion/integrantes/2/rol'],
      ['DELETE', '/api/administracion/integrantes/2'],
      ['GET', '/api/administracion/permisos'],
    ];
    for (const [m, ruta] of rutas) {
      const r = await s.pedir(m, ruta, m === 'GET' ? undefined : { rol_id: 2 });
      assert.equal(r.estado, 403, ruta);
    }
  });
  it('un permiso que niega la base de datos (42501) responde 403', async () => {
    prepararUsuario();
    bd.cuando('INSERT INTO ingresos', errorBd('42501'));
    const r = await s.pedir('POST', '/api/ingresos', { monto: 100, fuente: 'Tanda', tipo: 'tanda', periodicidad: 'unico' });
    assert.equal(r.estado, 403);
  });
});

describe('Gastos (RF013–RF018)', () => {
  beforeEach(() => prepararUsuario());

  it('RF013 / RF016: registra el gasto con el código del método de pago', async () => {
    bd.cuando('INSERT INTO gastos', { rows: [{ id: 8, monto: '350.50', fecha: '2026-11-21' }] });
    const r = await s.pedir('POST', '/api/gastos', { monto: '350.50', categoria_id: 2, metodo_pago_id: 3, descripcion: 'Súper' });
    assert.equal(r.estado, 201);
    assert.equal(bd.buscar('INSERT INTO gastos')[0]!.params[3], 'tarjeta_credito');
  });
  it('RF013: rechaza método de pago inexistente y datos inválidos', async () => {
    assert.equal((await s.pedir('POST', '/api/gastos', { monto: 10, categoria_id: 1, metodo_pago_id: 9 })).estado, 400);
    const r = await s.pedir('POST', '/api/gastos', { monto: -1 });
    assert.equal(r.estado, 400);
    assert.ok(r.cuerpo.errores.length >= 3);
  });
  it('RF014: edita y elimina un gasto de su familia', async () => {
    bd.cuando('SELECT usuario_id FROM gastos', { rows: [{ usuario_id: 1 }] });
    bd.cuando('UPDATE gastos', { rows: [{ id: 3, monto: '20', fecha: '2026-11-20' }] });
    bd.cuando('DELETE FROM gastos', { rowCount: 1 });
    assert.equal((await s.pedir('PUT', '/api/gastos/3', { monto: 20, categoria_id: 1, metodo_pago_id: 1 })).estado, 200);
    assert.equal((await s.pedir('DELETE', '/api/gastos/3')).estado, 200);
    assert.deepEqual(bd.buscar('DELETE FROM gastos')[0]!.params, [3, 10]);
  });
  it('RF014: un gasto de otra familia responde 404 y un id inválido 400', async () => {
    bd.cuando('SELECT usuario_id FROM gastos', { rows: [] });
    assert.equal((await s.pedir('DELETE', '/api/gastos/3')).estado, 404);
    assert.equal((await s.pedir('DELETE', '/api/gastos/abc')).estado, 400);
  });
  it('RF017: rechaza un periodo de consulta mayor a un año', async () => {
    const r = await s.pedir('GET', '/api/gastos?desde=2024-01-01&hasta=2026-01-01');
    assert.equal(r.estado, 400);
  });
});

describe('Ingresos (RF09–RF012)', () => {
  beforeEach(() => prepararUsuario());

  it('RF09 / RF011: registra un ingreso con su clasificación', async () => {
    bd.cuando('INSERT INTO ingresos', { rows: [{ id: 4, fecha: '2026-11-15', monto: '9000', fuente: 'Trabajo', tipo: 'salario', periodicidad: 'quincenal' }] });
    const r = await s.pedir('POST', '/api/ingresos', { monto: 9000, fuente: 'Trabajo', tipo: 'salario', periodicidad: 'quincenal' });
    assert.equal(r.estado, 201);
    assert.equal(r.cuerpo.ingreso.id, '4');
    assert.deepEqual(bd.buscar('INSERT INTO ingresos')[0]!.params.slice(0, 6), [10, 1, 9000, 'Trabajo', 'salario', 'quincenal']);
  });
  it('RF09: valida los datos del ingreso', async () => {
    const r = await s.pedir('POST', '/api/ingresos', { monto: 'mucho', fuente: '', tipo: 'x', periodicidad: 'y' });
    assert.equal(r.estado, 400);
    assert.equal(r.cuerpo.errores.length, 4);
  });
});

describe('Presupuesto (RF019–RF021)', () => {
  beforeEach(() => prepararUsuario());
  const presupuesto = { nombre: 'Noviembre', monto_total: 8000, desde: '2026-11-01', hasta: '2026-11-30', categorias: [{ categoria_id: 1, monto: 3000 }] };

  it('RF019 / RF020: crea el presupuesto y sus categorías en una transacción (RNF15)', async () => {
    bd.cuando('INSERT INTO presupuesto (', { rows: [{ id: 6 }] });
    bd.cuando('INSERT INTO presupuesto_por_categoria', { rowCount: 1 });
    const r = await s.pedir('POST', '/api/presupuestos', presupuesto);
    assert.equal(r.estado, 201);
    assert.equal(r.cuerpo.id, 6);
    assert.deepEqual(bd.transacciones(), ['BEGIN', 'COMMIT']);
  });
  it('RF020: la suma por categoría no puede superar el total ni repetir categoría', async () => {
    const excede = await s.pedir('POST', '/api/presupuestos', { ...presupuesto, categorias: [{ categoria_id: 1, monto: 9000 }] });
    assert.match(excede.cuerpo.error, /no puede superar el monto total/);
    const repetida = await s.pedir('POST', '/api/presupuestos', { ...presupuesto, categorias: [{ categoria_id: 1, monto: 1 }, { categoria_id: 1, monto: 1 }] });
    assert.match(repetida.cuerpo.error, /solo puede asignarse una vez/);
  });
  it('RF019: fechas invertidas responden 400 y un periodo traslapado 409', async () => {
    assert.equal((await s.pedir('POST', '/api/presupuestos', { ...presupuesto, desde: '2026-12-01' })).estado, 400);
    bd.cuando('INSERT INTO presupuesto (', errorBd('23P01'));
    const r = await s.pedir('POST', '/api/presupuestos', presupuesto);
    assert.equal(r.estado, 409);
    assert.deepEqual(bd.transacciones(), ['BEGIN', 'ROLLBACK']);
  });
  it('RNF15: si una categoría no está disponible se revierte todo', async () => {
    bd.cuando('INSERT INTO presupuesto (', { rows: [{ id: 6 }] });
    bd.cuando('INSERT INTO presupuesto_por_categoria', { rowCount: 0 });
    const r = await s.pedir('POST', '/api/presupuestos', presupuesto);
    assert.equal(r.estado, 400);
    assert.deepEqual(bd.transacciones(), ['BEGIN', 'ROLLBACK']);
  });
});

describe('Metas de ahorro (RF023–RF026)', () => {
  beforeEach(() => prepararUsuario());

  it('RF023: crea una meta familiar', async () => {
    bd.cuando('INSERT INTO meta_de_ahorro', { rows: [{ id: 3 }] });
    const r = await s.pedir('POST', '/api/metas', { nombre: 'Vacaciones', monto_objetivo: 20000, alcance: 'familia' });
    assert.equal(r.estado, 201);
    assert.equal(bd.buscar('INSERT INTO meta_de_ahorro')[0]!.params[1], null, 'meta de la familia: sin dueño');
  });
  it('RF023: un integrante no puede crear metas para otro integrante', async () => {
    bd.reiniciar();
    prepararUsuario({ id: 5, admin: false });
    s.usuario.id = 5;
    const r = await s.pedir('POST', '/api/metas', { nombre: 'Bici', monto_objetivo: 3000, alcance: 'personal', usuario_id: 1 });
    assert.equal(r.estado, 403);
  });
  it('RF023: exige indicar si la meta es familiar o personal', async () => {
    const r = await s.pedir('POST', '/api/metas', { nombre: 'X', monto_objetivo: 10 });
    assert.match(r.cuerpo.error, /familia o personal/);
  });
  it('RF024 / RNF15: registra la aportación dentro de una transacción', async () => {
    bd.cuando('FOR UPDATE OF m', { rows: [{ id: 3 }] });
    bd.cuando('INSERT INTO aportacion', { rowCount: 1 });
    const r = await s.pedir('POST', '/api/metas/3/aportaciones', { monto: 500 });
    assert.equal(r.estado, 201);
    assert.deepEqual(bd.transacciones(), ['BEGIN', 'COMMIT']);
  });
  it('RF024: aportación a una meta que no existe, monto inválido o fecha futura', async () => {
    bd.cuando('FOR UPDATE OF m', { rows: [] });
    assert.equal((await s.pedir('POST', '/api/metas/3/aportaciones', { monto: 500 })).estado, 404);
    assert.equal((await s.pedir('POST', '/api/metas/3/aportaciones', { monto: 0 })).estado, 400);
    const manana = fechaLocal(new Date(Date.now() + 86400000));
    assert.equal((await s.pedir('POST', '/api/metas/3/aportaciones', { monto: 5, fecha: manana })).estado, 400);
  });
  it('RF026: modifica una meta visible y responde 404 si no lo es', async () => {
    bd.cuando('SELECT m.usuario_id, m.creada_por', { rows: [{ usuario_id: null, creada_por: 1 }] });
    bd.cuando('UPDATE meta_de_ahorro', { rowCount: 1 });
    assert.equal((await s.pedir('PUT', '/api/metas/3', { nombre: 'Viaje', monto_objetivo: 25000 })).estado, 200);
    bd.cuando('SELECT m.usuario_id, m.creada_por', { rows: [] });
    assert.equal((await s.pedir('PUT', '/api/metas/3', { nombre: 'Viaje', monto_objetivo: 25000 })).estado, 404);
  });
});

describe('Resumen y reportes (RF027–RF031, RF041–RF043)', () => {
  beforeEach(() => {
    prepararUsuario();
    bd.cuando('FROM ingresos i\n        WHERE', { rows: [{ familia: '20000', mio: '20000' }] });
    bd.cuando(/SELECT COALESCE\(sum\(monto\), 0\) AS familia/, { rows: [{ familia: '25000', mio: '25000' }] });
    bd.cuando('fn_gastos_por_categoria', { rows: [] });
    bd.cuando('GROUP BY mes', { rows: [] });
    // movimientos: solo gastos (con filtro) o ingresos y gastos juntos
    bd.cuando('JOIN categoria_de_los_gastos c ON c.id = g.categoria_id', { rows: [] });
    bd.cuando('UNION ALL', { rows: [] });
    bd.cuando('FROM meta_de_ahorro m', { rows: [] });
  });

  it('RF027–RF031: el resumen trae totales, categorías, serie mensual, movimientos y metas', async () => {
    const r = await s.pedir('GET', '/api/reportes/resumen?desde=2026-01-01&hasta=2026-11-21');
    assert.equal(r.estado, 200);
    for (const clave of ['totales', 'categorias', 'por_mes', 'movimientos', 'metas']) assert.ok(clave in r.cuerpo, clave);
    assert.equal(r.cuerpo.totales.familia.deficit, true, 'RF036: déficit');
  });
  it('RF043: reporte familiar con balance', async () => {
    const r = await s.pedir('GET', '/api/reportes/familiar');
    assert.equal(r.estado, 200);
    assert.equal(r.cuerpo.balance, -5000);
  });
  it('RF041: el filtro de tipo solo acepta ingreso o gasto', async () => {
    assert.equal((await s.pedir('GET', '/api/reportes/ingresos-egresos?tipo=otro')).estado, 400);
    assert.equal((await s.pedir('GET', '/api/reportes/ingresos-egresos?tipo=gasto')).estado, 200);
  });
  it('RNF10: los reportes aceptan hasta un año y rechazan periodos mayores', async () => {
    assert.equal((await s.pedir('GET', '/api/reportes/categorias?desde=2025-11-22&hasta=2026-11-21')).estado, 200);
    assert.equal((await s.pedir('GET', '/api/reportes/categorias?desde=2020-01-01&hasta=2026-11-21')).estado, 400);
  });
});

describe('Notificaciones (RF032–RF036)', () => {
  beforeEach(() => prepararUsuario());

  it('lista solo las del usuario, con título según el tipo y conteo de no leídas', async () => {
    bd.cuando('FROM notificacion n', {
      rows: [
        { id: 1, tipo: 'corte', mensaje: 'Tu corte es el 5', leida: false, fecha: '2026-11-20' },
        { id: 2, tipo: 'deficit', mensaje: 'Gastaste más', leida: true, fecha: '2026-11-19' },
        { id: 3, tipo: 'desconocido', mensaje: 'x', leida: false, fecha: '2026-11-18' },
      ],
    });
    const r = await s.pedir('GET', '/api/notificaciones');
    assert.equal(r.cuerpo.sin_leer, 2);
    assert.deepEqual(r.cuerpo.notificaciones.map((n: any) => n.titulo), ['Fecha de corte próxima', 'Déficit detectado', 'Aviso']);
    assert.deepEqual(bd.buscar('FROM notificacion n')[0]!.params, [1]);
  });
  it('marcar como leída solo afecta las del propio usuario', async () => {
    bd.cuando('UPDATE notificacion', { rowCount: 1 });
    assert.equal((await s.pedir('POST', '/api/notificaciones/7/leer')).estado, 200);
    assert.deepEqual(bd.buscar('UPDATE notificacion')[0]!.params, [7, 1]);
    assert.equal((await s.pedir('POST', '/api/notificaciones/x/leer')).estado, 400);
  });
});

describe('Configuración de usuario (RF05–RF08)', () => {
  beforeEach(() => {
    prepararUsuario();
    bd.cuando('FROM categoria_de_los_gastos', { rows: [{ id: 1, nombre: 'Alimentos' }] });
  });

  it('devuelve los catálogos de métodos de pago y categorías', async () => {
    const r = await s.pedir('GET', '/api/configuracion/catalogos');
    assert.equal(r.cuerpo.metodos_pago.length, 4);
    assert.deepEqual(r.cuerpo.categorias, [{ id: 1, nombre: 'Alimentos' }]);
  });
  it('rechaza el cuestionario con errores por campo', async () => {
    const r = await s.pedir('POST', '/api/configuracion/completar', { recibe_sueldo: true, metodos_pago: [] });
    assert.equal(r.estado, 400);
    assert.ok(r.cuerpo.errores.length >= 2);
  });
  it('el cuestionario inicial solo se puede completar una vez', async () => {
    bd.cuando('SELECT perfil_completo FROM usuario', { rows: [{ perfil_completo: true }] });
    const r = await s.pedir('POST', '/api/configuracion/completar', { recibe_sueldo: false, metodos_pago: [{ metodo_pago_id: 1, alias: 'Efectivo' }] });
    assert.equal(r.estado, 409);
    assert.deepEqual(bd.transacciones(), ['BEGIN', 'ROLLBACK']);
  });
});

describe('Administración familiar (RF037–RF040, RNF32)', () => {
  beforeEach(() => prepararUsuario({ id: 1 }));

  it('RF037: lista integrantes y marca al usuario actual', async () => {
    bd.cuando('SELECT nombre FROM familia', { rows: [{ nombre: 'Los Pérez' }] });
    bd.cuando('u.email, u.rol_id', { rows: [{ id: 1, nombre: 'Ana', email: 'a@x.com', rol_id: 1, rol: 'administrador' }, { id: 2, nombre: 'Luis', email: 'l@x.com', rol_id: 15, rol: 'integrante' }] });
    const r = await s.pedir('GET', '/api/administracion/integrantes');
    assert.equal(r.cuerpo.familia, 'Los Pérez');
    assert.deepEqual(r.cuerpo.integrantes.map((i: any) => [i.rol_id, i.es_yo]), [[1, true], [2, false]]);
  });
  it('RF038: la familia debe conservar al menos un administrador', async () => {
    bd.cuando('FOR UPDATE', { rows: [{ id: 1, rol_id: 1 }, { id: 2, rol_id: 2 }] });
    const r = await s.pedir('PUT', '/api/administracion/integrantes/1/rol', { rol_id: 2 });
    assert.equal(r.estado, 400);
    assert.match(r.cuerpo.error, /al menos un administrador/);
  });
  it('RF038: cambia el rol de un integrante de su familia', async () => {
    bd.cuando('FOR UPDATE', { rows: [{ id: 1, rol_id: 1 }, { id: 2, rol_id: 2 }] });
    bd.cuando('fn_cambiar_rol', { rows: [{}] });
    const r = await s.pedir('PUT', '/api/administracion/integrantes/2/rol', { rol_id: 1 });
    assert.equal(r.estado, 200);
    assert.deepEqual(bd.buscar('fn_cambiar_rol')[0]!.params, [1, 2, 1]);
  });
  it('RF040: no puede eliminarse a sí mismo ni a alguien de otra familia', async () => {
    assert.equal((await s.pedir('DELETE', '/api/administracion/integrantes/1')).estado, 400);
    bd.cuando('FOR UPDATE', { rows: [{ id: 1, rol_id: 1 }] });
    assert.equal((await s.pedir('DELETE', '/api/administracion/integrantes/8')).estado, 404);
  });
  it('RF040 / RNF32: eliminar un integrante usa fn_eliminar_integrante (anonimiza sus datos)', async () => {
    bd.cuando('FOR UPDATE', { rows: [{ id: 1, rol_id: 1 }, { id: 2, rol_id: 2 }] });
    bd.cuando('fn_eliminar_integrante', { rows: [{}] });
    bd.cuando('DELETE FROM ingresos', { rowCount: 1 });
    const r = await s.pedir('DELETE', '/api/administracion/integrantes/2');
    assert.equal(r.estado, 200);
    assert.deepEqual(bd.buscar('fn_eliminar_integrante')[0]!.params, [1, 2]);
    // RNF32_ también se quita el ingreso automático de este mes del integrante eliminado
    assert.equal(bd.buscar('DELETE FROM ingresos')[0]!.params[0], 2);
  });
  it('RNF32: al darse de baja se quita el ingreso automático de este mes', async () => {
    bd.cuando('FOR UPDATE', { rows: [{ id: 1, rol_id: 1 }, { id: 2, rol_id: 1 }] });
    bd.cuando('fn_dar_de_baja', { rows: [{}] });
    bd.cuando('DELETE FROM ingresos', { rowCount: 1 });
    const r = await s.pedir('DELETE', '/api/administracion/cuenta', { confirmacion: 'ELIMINAR' });
    assert.equal(r.estado, 200);
    assert.equal(bd.buscar('DELETE FROM ingresos')[0]!.params[0], 1);
  });
  it('RNF32: darse de baja exige escribir ELIMINAR y no deja a la familia sin administrador', async () => {
    assert.equal((await s.pedir('DELETE', '/api/administracion/cuenta', { confirmacion: 'si' })).estado, 400);
    bd.cuando('FOR UPDATE', { rows: [{ id: 1, rol_id: 1 }, { id: 2, rol_id: 2 }] });
    const r = await s.pedir('DELETE', '/api/administracion/cuenta', { confirmacion: 'ELIMINAR' });
    assert.match(r.cuerpo.error, /único administrador/);
  });
  it('RF039: un permiso que no existe responde 404', async () => {
    const r = await s.pedir('PUT', '/api/administracion/permisos', { clave: 'familia.administrar', permitido: true });
    assert.equal(r.estado, 404);
  });
});
