// Pruebas unitarias de las validaciones (funciones puras, sin base de datos)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { montoValido, textoRecortado } from '../src/modulos/compartido/errores';
import { esFechaValida, fechaLocal, leerId, leerPeriodo, validarGasto } from '../src/modulos/gastos/gastos.validaciones';
import { PERIODICIDADES_INGRESO, TIPOS_INGRESO, validarIngreso } from '../src/modulos/ingresos/ingresos.validaciones';
import { type CatalogosValidacion, validarConfiguracion } from '../src/modulos/configuracion/configuracion.validaciones';

const hoy = fechaLocal(new Date());
const manana = fechaLocal(new Date(Date.now() + 86400000));

describe('Utilidades comunes', () => {
  it('montoValido acepta montos positivos con hasta 2 decimales', () => {
    for (const v of ['1', '10.5', '99.99', 1500, '9999999999.99']) assert.equal(montoValido(v), true, String(v));
  });
  it('montoValido rechaza cero, negativos, 3 decimales, texto y montos enormes (RNF21)', () => {
    for (const v of ['0', '-5', '1.234', 'abc', '', null, undefined, '10000000000', '1e5']) {
      assert.equal(montoValido(v), false, String(v));
    }
  });
  it('textoRecortado quita espacios y convierte lo que no es texto en cadena vacía', () => {
    assert.equal(textoRecortado('  Hola  '), 'Hola');
    assert.equal(textoRecortado(123), '');
    assert.equal(textoRecortado(undefined), '');
  });
});

describe('Fechas y periodos (RF012, RF017, RNF10)', () => {
  it('esFechaValida acepta AAAA-MM-DD reales', () => {
    assert.equal(esFechaValida('2026-02-28'), true);
    assert.equal(esFechaValida('2024-02-29'), true);
  });
  it('esFechaValida rechaza fechas que no existen o con otro formato', () => {
    for (const f of ['2026-02-30', '2026-13-01', '21/11/2026', '2026-1-1', '', null, 20261121]) {
      assert.equal(esFechaValida(f), false, String(f));
    }
  });
  it('fechaLocal arma AAAA-MM-DD con ceros', () => {
    assert.equal(fechaLocal(new Date(2026, 0, 5)), '2026-01-05');
  });
  it('leerPeriodo usa el mes actual si no se mandan fechas', () => {
    const p = leerPeriodo({});
    assert.equal(p.error, undefined);
    assert.equal(p.desde, `${hoy.slice(0, 7)}-01`);
    assert.equal(p.hasta, hoy);
  });
  it('leerPeriodo acepta un periodo de un año (RNF10)', () => {
    assert.equal(leerPeriodo({ desde: '2025-11-22', hasta: '2026-11-21' }).error, undefined);
  });
  it('leerPeriodo rechaza periodos de más de un año, invertidos o con fechas inválidas', () => {
    assert.match(leerPeriodo({ desde: '2024-01-01', hasta: '2026-01-01' }).error!, /un año/);
    assert.match(leerPeriodo({ desde: '2026-05-01', hasta: '2026-04-01' }).error!, /mayor a la final/);
    assert.match(leerPeriodo({ desde: 'ayer', hasta: '2026-04-01' }).error!, /no son válidas/);
  });
  it('leerId solo acepta enteros positivos', () => {
    assert.equal(leerId('15'), 15);
    for (const v of ['0', '-1', '1.5', 'abc', '1 OR 1=1', undefined]) assert.equal(leerId(v), null, String(v));
  });
});

describe('Validación de gastos (RF013–RF016)', () => {
  const valido = { monto: '250.50', categoria_id: 3, metodo_pago_id: 1, descripcion: ' Súper ', fecha: hoy };

  it('acepta un gasto correcto y normaliza sus datos', () => {
    const { errores, datos } = validarGasto(valido);
    assert.deepEqual(errores, []);
    assert.deepEqual(datos, { monto: 250.5, categoria_id: 3, metodo_pago_id: 1, fecha: hoy, descripcion: 'Súper' });
  });
  it('sin fecha usa la de hoy (fecha null) y descripción vacía queda en null', () => {
    const { errores, datos } = validarGasto({ ...valido, fecha: '', descripcion: '   ' });
    assert.deepEqual(errores, []);
    assert.equal(datos.fecha, null);
    assert.equal(datos.descripcion, null);
  });
  it('rechaza monto negativo con un mensaje claro (RNF21)', () => {
    assert.match(validarGasto({ ...valido, monto: '-5' }).errores.join(), /monto debe ser un número mayor a 0/);
  });
  it('exige categoría (RF015) y método de pago (RF016)', () => {
    const { errores } = validarGasto({ monto: 10 });
    assert.ok(errores.some((e) => e.includes('categoría')));
    assert.ok(errores.some((e) => e.includes('método de pago')));
  });
  it('rechaza fechas futuras y descripciones de más de 200 caracteres', () => {
    assert.match(validarGasto({ ...valido, fecha: manana }).errores.join(), /no puede ser futura/);
    assert.match(validarGasto({ ...valido, descripcion: 'x'.repeat(201) }).errores.join(), /200 caracteres/);
  });
});

describe('Validación de ingresos (RF09–RF011)', () => {
  const valido = { monto: 15000, fuente: 'Trabajo', tipo: 'salario', periodicidad: 'mensual' };

  it('acepta un ingreso correcto', () => {
    const r = validarIngreso(valido);
    assert.deepEqual(r.errores, []);
    assert.equal(r.datos.fecha, null);
  });
  it('las clasificaciones son salario, tanda, préstamo u otro (RF011)', () => {
    assert.deepEqual([...TIPOS_INGRESO], ['salario', 'tanda', 'prestamo', 'otro']);
    for (const tipo of TIPOS_INGRESO) assert.deepEqual(validarIngreso({ ...valido, tipo }).errores, []);
    assert.match(validarIngreso({ ...valido, tipo: 'loteria' }).errores.join(), /tipo de ingreso/);
  });
  it('valida la periodicidad', () => {
    for (const periodicidad of PERIODICIDADES_INGRESO) assert.deepEqual(validarIngreso({ ...valido, periodicidad }).errores, []);
    assert.match(validarIngreso({ ...valido, periodicidad: 'diaria' }).errores.join(), /periodicidad/);
  });
  it('rechaza monto cero, fuente vacía y fecha futura', () => {
    const { errores } = validarIngreso({ ...valido, monto: 0, fuente: '  ', fecha: manana });
    assert.equal(errores.length, 3);
  });
  it('no falla si el cuerpo no es un objeto', () => {
    assert.ok(validarIngreso(null).errores.length > 0);
  });
});

describe('Validación del cuestionario de configuración (RF05–RF08, RNF07)', () => {
  const catalogos: CatalogosValidacion = {
    metodos: new Map([
      [1, { nombre: 'Efectivo', es_credito: false }],
      [2, { nombre: 'Tarjeta de débito', es_credito: false }],
      [3, { nombre: 'Tarjeta de crédito', es_credito: true }],
    ]),
    categorias: new Set([1, 2]),
  };
  const base = {
    recibe_sueldo: true,
    ingreso_principal: 18000,
    dias_ingreso: [30, 15, 15],
    metodos_pago: [{ metodo_pago_id: 1, alias: 'Efectivo' }],
    gastos_fijos: [],
  };

  it('acepta una configuración completa y ordena los días de ingreso sin repetir', () => {
    const { errores, datos } = validarConfiguracion(base, catalogos);
    assert.deepEqual(errores, []);
    assert.deepEqual(datos.dias_ingreso, [15, 30]);
    assert.equal(datos.recibe_sueldo, true);
  });
  it('RF05: exige indicar si recibe sueldo; sin sueldo no pide ingreso principal', () => {
    assert.match(validarConfiguracion({ ...base, recibe_sueldo: 'si' }, catalogos).errores.join(), /recibes un sueldo/);
    const sinSueldo = validarConfiguracion({ recibe_sueldo: false, metodos_pago: base.metodos_pago }, catalogos);
    assert.deepEqual(sinSueldo.errores, []);
    assert.equal(sinSueldo.datos.ingreso_principal, null);
  });
  it('RF06: exige al menos un método de pago válido y sin repetir', () => {
    assert.match(validarConfiguracion({ ...base, metodos_pago: [] }, catalogos).errores.join(), /al menos un método/);
    assert.match(validarConfiguracion({ ...base, metodos_pago: [{ metodo_pago_id: 99 }] }, catalogos).errores.join(), /válido/);
    const repetido = [{ metodo_pago_id: 1, alias: 'A' }, { metodo_pago_id: 1, alias: 'B' }];
    assert.match(validarConfiguracion({ ...base, metodos_pago: repetido }, catalogos).errores.join(), /repetido/);
  });
  it('RF07: la tarjeta de crédito necesita día de corte y día límite de pago (1–31)', () => {
    const sinDias = [{ metodo_pago_id: 3, alias: 'Visa' }];
    const r = validarConfiguracion({ ...base, metodos_pago: sinDias }, catalogos);
    assert.ok(r.errores.some((e) => e.includes('día de corte')));
    assert.ok(r.errores.some((e) => e.includes('día límite de pago')));
    const ok = validarConfiguracion(
      { ...base, metodos_pago: [{ metodo_pago_id: 3, alias: 'Visa', dia_corte: 5, dia_limite_pago: 25 }] },
      catalogos
    );
    assert.deepEqual(ok.errores, []);
    assert.equal(ok.datos.metodos[0]!.dia_corte, 5);
  });
  it('RNF07: no permite guardar el número de la tarjeta en el alias', () => {
    const conNumero = [{ metodo_pago_id: 3, alias: '4152 3133 0000 1234', dia_corte: 5, dia_limite_pago: 25 }];
    assert.match(validarConfiguracion({ ...base, metodos_pago: conNumero }, catalogos).errores.join(), /número de la tarjeta/);
  });
  it('solo se registra una tarjeta de crédito', () => {
    const dos = [
      { metodo_pago_id: 3, alias: 'Visa', dia_corte: 5, dia_limite_pago: 25 },
      { metodo_pago_id: 3, alias: 'Master', dia_corte: 6, dia_limite_pago: 26 },
    ];
    assert.match(validarConfiguracion({ ...base, metodos_pago: dos }, catalogos).errores.join(), /solo se puede registrar una/);
  });
  it('RF08: valida los gastos fijos y pone 3 días de aviso por defecto', () => {
    const fijo = { descripcion: 'Colegiatura', categoria_id: 1, monto: 3500, dia_pago: 10 };
    const ok = validarConfiguracion({ ...base, gastos_fijos: [fijo] }, catalogos);
    assert.deepEqual(ok.errores, []);
    assert.equal(ok.datos.gastosFijos[0]!.dias_aviso, 3);
    assert.match(validarConfiguracion({ ...base, gastos_fijos: [{ ...fijo, categoria_id: 77 }] }, catalogos).errores.join(), /categoría/);
    assert.match(validarConfiguracion({ ...base, gastos_fijos: [{ ...fijo, dia_pago: 40 }] }, catalogos).errores.join(), /día de pago/);
    assert.match(validarConfiguracion({ ...base, gastos_fijos: [{ ...fijo, descripcion: '' }] }, catalogos).errores.join(), /descripción/);
  });
});
