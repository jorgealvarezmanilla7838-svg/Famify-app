import { esFechaValida, fechaLocal } from '../gastos/gastos.validaciones';

export const TIPOS_INGRESO = ['salario', 'tanda', 'prestamo', 'otro'] as const;
export const PERIODICIDADES_INGRESO = ['unico', 'semanal', 'quincenal', 'mensual', 'anual'] as const;

export const validarIngreso = (body: any) => {
  const errores: string[] = [];
  const datos = body && typeof body === 'object' ? body : {};

  if (!/^\d+(\.\d{1,2})?$/.test(String(datos.monto ?? '')) || Number(datos.monto) <= 0) {
    errores.push('El monto debe ser un número mayor a 0, con máximo 2 decimales.');
  } else if (Number(datos.monto) > 9999999999.99) {
    errores.push('El monto es demasiado grande.');
  }

  const fuente = typeof datos.fuente === 'string' ? datos.fuente.trim() : '';
  if (!fuente || fuente.length > 100) {
    errores.push('La fuente es obligatoria y no puede pasar de 100 caracteres.');
  }

  if (!TIPOS_INGRESO.includes(datos.tipo)) {
    errores.push('Selecciona un tipo de ingreso válido.');
  }

  if (!PERIODICIDADES_INGRESO.includes(datos.periodicidad)) {
    errores.push('Selecciona una periodicidad válida.');
  }

  let fecha: string | null = null;
  if (datos.fecha !== undefined && datos.fecha !== null && datos.fecha !== '') {
    if (!esFechaValida(datos.fecha)) {
      errores.push('La fecha no es válida (usa el formato AAAA-MM-DD).');
    } else if (datos.fecha > fechaLocal(new Date())) {
      errores.push('La fecha del ingreso no puede ser futura.');
    } else {
      fecha = datos.fecha;
    }
  }

  return {
    errores,
    datos: {
      monto: Number(datos.monto),
      fuente,
      tipo: datos.tipo,
      periodicidad: datos.periodicidad,
      fecha,
    },
  };
};
