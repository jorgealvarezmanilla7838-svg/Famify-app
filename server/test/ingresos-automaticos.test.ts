// Pruebas del registro automático del ingreso mensual configurado (RF05, RF09)
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bd } from './apoyo/bd-falsa';
import { pool } from '../src/db';
import {
  FUENTE_SUELDO_AUTOMATICO,
  calcularIngresosDelMes,
  quitarIngresosAutomaticosDelMes,
  registrarSueldoAutomatico,
} from '../src/modulos/ingresos/ingresos.automaticos';

beforeEach(() => bd.reiniciar());

describe('Reparto del ingreso mensual (RF05)', () => {
  it('con un solo día de ingreso se registra el monto completo', () => {
    assert.deepEqual(calcularIngresosDelMes('1000.00', [1], 2026, 11), [{ dia: 1, monto: 1000 }]);
  });
  it('con varios días reparte el monto y el último recibe el sobrante', () => {
    assert.deepEqual(calcularIngresosDelMes('1000.01', [15, 30], 2026, 11), [
      { dia: 15, monto: 500 },
      { dia: 30, monto: 500.01 },
    ]);
  });
  it('ajusta los días 29, 30 y 31 al último día del mes', () => {
    assert.deepEqual(calcularIngresosDelMes('900', [31], 2027, 2), [{ dia: 28, monto: 900 }]);
  });
  it('no registra nada si no hay días o el monto no alcanza para repartirse', () => {
    assert.deepEqual(calcularIngresosDelMes('1000', [], 2026, 11), []);
    assert.deepEqual(calcularIngresosDelMes('0.01', [1, 2], 2026, 11), []);
  });
});

describe('Registro automático del ingreso (RF09)', () => {
  const preparar = (id: number) => {
    bd.cuando('to_char(now() AT TIME ZONE', { rows: [{ hoy: '2026-11-24' }] });
    bd.cuando('FROM usuario u', {
      rows: [{ id, familia_id: 10, ingreso_principal: '1000.00', dias_de_ingreso: [1, 28] }],
    });
    bd.cuando('INSERT INTO ingresos', { rowCount: 1 });
    bd.cuando('UPDATE ingresos', { rowCount: 1 });
  };

  it('registra solo los días de ingreso que ya llegaron este mes', async () => {
    preparar(101);
    await registrarSueldoAutomatico(101);
    const inserciones = bd.buscar('INSERT INTO ingresos');
    assert.equal(inserciones.length, 1);
    assert.deepEqual(inserciones[0]!.params, [10, 101, 500, FUENTE_SUELDO_AUTOMATICO, '2026-11-01']);
  });
  it('no vuelve a crear un ingreso ya revisado, aunque se haya borrado a mano', async () => {
    preparar(102);
    await registrarSueldoAutomatico(102);
    await registrarSueldoAutomatico(102);
    assert.equal(bd.buscar('INSERT INTO ingresos').length, 1);
  });
  it('al guardar la configuración actualiza el monto de este mes y vuelve a revisar', async () => {
    preparar(103);
    await registrarSueldoAutomatico(103);
    await registrarSueldoAutomatico(103, true);
    assert.equal(bd.buscar('UPDATE ingresos').length, 2);
    assert.equal(bd.buscar('INSERT INTO ingresos').length, 2);
  });
  it('solo toma a quien recibe sueldo y puede registrar ingresos', async () => {
    preparar(104);
    await registrarSueldoAutomatico(104);
    const consulta = bd.buscar('FROM usuario u')[0]!.sql;
    assert.match(consulta, /u\.recibe_sueldo/);
    assert.match(consulta, /fn_tiene_permiso\(u\.id, 'ingresos\.registrar'\)/);
  });
});

describe('Baja de un usuario (RNF32)', () => {
  it('borra solo sus ingresos automáticos del mes actual en adelante', async () => {
    bd.cuando('DELETE FROM ingresos', { rowCount: 1 });
    await quitarIngresosAutomaticosDelMes(pool, 55);
    const borrado = bd.buscar('DELETE FROM ingresos')[0]!;
    assert.deepEqual(borrado.params.slice(0, 2), [55, FUENTE_SUELDO_AUTOMATICO]);
    assert.match(borrado.sql, /fuente = \$2::varchar/);
    assert.match(borrado.sql, /fecha >= date_trunc\('month'/);
  });
});
