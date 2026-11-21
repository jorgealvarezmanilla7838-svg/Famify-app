// Pruebas unitarias de servicios y catálogos: presupuesto (RF021–RF022), metas (RF025, RF031),
// resumen y reportes (RF027–RF030, RF036, RF041–RF043), roles y permisos (RF039)
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bd } from './apoyo/bd-falsa';
import { pool } from '../src/db';
import { METODOS_PAGO, metodoPorCodigo, metodoPorId } from '../src/catalogos';
import { CLAVES_PERMISO, PERMISOS_EDITABLES } from '../src/modulos/compartido/permisos';
import { ROL_ADMIN, ROL_INTEGRANTE, rolIntegranteDeFamilia } from '../src/modulos/compartido/roles';
import { estadoLimite, listarPresupuestos } from '../src/modulos/presupuesto/presupuesto.servicio';
import { listarMetas } from '../src/modulos/metas/metas.servicio';
import {
  obtenerCategorias,
  obtenerMovimientos,
  obtenerPorMes,
  obtenerTotales,
} from '../src/modulos/reportes/reportes.servicio';

beforeEach(() => bd.reiniciar());

describe('Catálogos de métodos de pago (RF06, RF016)', () => {
  it('tiene efectivo, débito, crédito y otro; solo crédito es de crédito', () => {
    assert.deepEqual(METODOS_PAGO.map((m) => m.codigo), ['efectivo', 'tarjeta_debito', 'tarjeta_credito', 'otro']);
    assert.deepEqual(METODOS_PAGO.filter((m) => m.es_credito).map((m) => m.id), [3]);
  });
  it('busca por id y por código', () => {
    assert.equal(metodoPorId(2)?.nombre, 'Tarjeta de débito');
    assert.equal(metodoPorCodigo('efectivo')?.id, 1);
    assert.equal(metodoPorId(99), undefined);
  });
});

describe('Roles y permisos (RF038, RF039, RNF03)', () => {
  it('los permisos de familia (invitar y administrar) no se pueden dar a un integrante', () => {
    assert.ok(CLAVES_PERMISO.includes('familia.administrar'));
    assert.equal(PERMISOS_EDITABLES.some((p) => p.clave.startsWith('familia.')), false);
    assert.equal(PERMISOS_EDITABLES.length, CLAVES_PERMISO.length - 2);
  });
  it('rolIntegranteDeFamilia usa el rol propio de la familia si existe', async () => {
    bd.cuando("lower(nombre) = 'integrante'", { rows: [{ id: 15 }] });
    assert.equal(await rolIntegranteDeFamilia(pool, 10), 15);
  });
  it('rolIntegranteDeFamilia usa el rol base integrante si la familia no personalizó permisos', async () => {
    bd.cuando("lower(nombre) = 'integrante'", { rows: [] });
    assert.equal(await rolIntegranteDeFamilia(pool, 10), ROL_INTEGRANTE);
    assert.equal(ROL_ADMIN, 1);
  });
});

describe('Presupuesto: alertas de límite (RF022, RF035)', () => {
  it('ok por debajo del umbral, cerca desde el 80 % y excedido al superar el límite', () => {
    assert.equal(estadoLimite(799, 1000), 'ok');
    assert.equal(estadoLimite(800, 1000), 'cerca');
    assert.equal(estadoLimite(1000, 1000), 'cerca');
    assert.equal(estadoLimite(1000.01, 1000), 'excedido');
  });
  it('respeta un umbral personalizado', () => {
    assert.equal(estadoLimite(600, 1000, 50), 'cerca');
    assert.equal(estadoLimite(400, 1000, 50), 'ok');
  });
  it('RF021: calcula lo disponible del presupuesto y de cada categoría', async () => {
    bd.cuando('FROM v_presupuesto_estado', {
      rows: [{ id: 4, nombre: 'Noviembre', monto_total: '10000', umbral_alerta: '80', desde: '2026-11-01', hasta: '2026-11-30', gastado: '8500.5' }],
    });
    bd.cuando('FROM v_presupuesto_categoria_estado', {
      rows: [
        { presupuesto_id: 4, categoria_id: 1, categoria: 'Alimentos', monto: '3000', gastado: '3100' },
        { presupuesto_id: 4, categoria_id: 2, categoria: 'Transporte', monto: '1000', gastado: '100' },
        { presupuesto_id: 99, categoria_id: 1, categoria: 'De otro presupuesto', monto: '1', gastado: '0' },
      ],
    });
    const [p] = await listarPresupuestos(10);
    assert.equal(p!.disponible, 1499.5);
    assert.equal(p!.estado, 'cerca');
    assert.deepEqual(
      p!.categorias.map((c) => [c.categoria, c.disponible, c.estado]),
      [
        ['Alimentos', -100, 'excedido'],
        ['Transporte', 900, 'ok'],
      ]
    );
    assert.equal(bd.buscar('FROM v_presupuesto_estado')[0]!.params[0], 10, 'RNF04: solo la familia del usuario');
  });
});

describe('Metas de ahorro: progreso (RF025, RF031)', () => {
  const filas = [
    { id: 1, nombre: 'Vacaciones', descripcion: null, monto_objetivo: '20000', monto_ahorrado: '5000', fecha_limite: null, usuario_id: null, creada_por: 1, integrante: null },
    { id: 2, nombre: 'Bici', descripcion: 'Roja', monto_objetivo: '3000', monto_ahorrado: '3500', fecha_limite: '2026-12-24', usuario_id: 2, creada_por: 2, integrante: 'Luis' },
  ];

  it('calcula porcentaje, faltante y alcance', async () => {
    bd.cuando('FROM meta_de_ahorro m', { rows: filas });
    const [familiar, personal] = await listarMetas({ usuarioId: 1, familiaId: 10, esAdmin: true });
    assert.deepEqual([familiar!.porcentaje, familiar!.faltante, familiar!.alcance], [25, 15000, 'familia']);
    assert.deepEqual([personal!.porcentaje, personal!.faltante, personal!.alcance], [100, 0, 'personal']);
  });
  it('el integrante solo puede editar sus metas; el administrador todas', async () => {
    bd.cuando('FROM meta_de_ahorro m', { rows: filas });
    const comoIntegrante = await listarMetas({ usuarioId: 2, familiaId: 10, esAdmin: false });
    assert.deepEqual(comoIntegrante.map((m) => m.puede_editar), [false, true]);
    assert.deepEqual(bd.buscar('FROM meta_de_ahorro m')[0]!.params, [10, false, 2]);
  });
});

describe('Resumen y reportes (RF027–RF030, RF036, RF041–RF043)', () => {
  const contexto = { usuarioId: 1, familiaId: 10, esAdmin: true, verDetalle: true };

  it('RF028 / RF036: balance y déficit cuando salen más de los que entran', async () => {
    bd.cuando('FROM ingresos i', { rows: [{ familia: '10000', mio: '6000' }] });
    bd.cuando('FROM gastos', { rows: [{ familia: '12500.75', mio: '2000' }] });
    const t = await obtenerTotales(contexto, '2026-11-01', '2026-11-30');
    assert.deepEqual(t.familia, { ingresos: 10000, gastos: 12500.75, balance: -2500.75, deficit: true });
    assert.deepEqual(t.mio, { ingresos: 6000, gastos: 2000, balance: 4000, deficit: false });
  });
  it('RF029 / RF042: gastos por categoría con totales numéricos', async () => {
    bd.cuando('fn_gastos_por_categoria', { rows: [{ categoria_id: '1', categoria: 'Alimentos', total: '1500.50', porcentaje: '60.2' }] });
    assert.deepEqual(await obtenerCategorias(10, '2026-01-01', '2026-12-31'), [
      { categoria_id: 1, categoria: 'Alimentos', total: 1500.5, porcentaje: 60.2 },
    ]);
  });
  it('RF030: serie mensual de ingresos contra gastos', async () => {
    bd.cuando('GROUP BY mes', { rows: [{ mes: '2026-10', ingresos: '18000', gastos: '9000' }] });
    assert.deepEqual(await obtenerPorMes(10, '2026-01-01', '2026-12-31'), [{ mes: '2026-10', ingresos: 18000, gastos: 9000 }]);
  });
  it('RF041: muestra el nombre del método de pago en los movimientos', async () => {
    bd.cuando('UNION ALL', { rows: [{ tipo: 'gasto', fecha: '2026-11-02', monto: '99.9', metodo_pago: 'tarjeta_credito' }] });
    const [m] = await obtenerMovimientos(contexto, { desde: '2026-11-01', hasta: '2026-11-30' });
    assert.equal(m!.metodo_pago, 'Tarjeta de crédito');
    assert.equal(m!.monto, 99.9);
  });
  it('RNF04: un integrante sin permiso de detalle solo recibe sus propios movimientos', async () => {
    bd.cuando('UNION ALL', { rows: [] });
    await obtenerMovimientos(
      { usuarioId: 5, familiaId: 10, esAdmin: false, verDetalle: false },
      { desde: '2026-11-01', hasta: '2026-11-30', usuarioId: 1 }
    );
    const [c] = bd.buscar('UNION ALL');
    assert.deepEqual(c!.params, [10, '2026-11-01', '2026-11-30', 5], 'pidió ver al usuario 1, pero se filtra por él mismo (5)');
  });
  it('filtrar por categoría o por tipo gasto excluye los ingresos', async () => {
    bd.cuando('FROM gastos g', { rows: [] });
    await obtenerMovimientos(contexto, { desde: '2026-11-01', hasta: '2026-11-30', categoriaId: 3 });
    assert.equal(bd.buscar('FROM ingresos i').length, 0);
    assert.equal(await obtenerMovimientos(contexto, { desde: '2026-11-01', hasta: '2026-11-30', tipo: 'ingreso', categoriaId: 3 }).then((r) => r.length), 0);
  });
});
