// Validaciones del módulo de gastos
import { metodoPorId } from '../../catalogos';

const dosDigitos = (n: number) => String(n).padStart(2, '0');

// fecha local en formato AAAA-MM-DD
export const fechaLocal = (d: Date) =>
  `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}`;

// revisa que sea una fecha real, por ejemplo 2026-02-31 no existe
export const esFechaValida = (texto: any) => {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const d = new Date(texto + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
};

const esEnteroPositivo = (valor: any) => /^\d+$/.test(String(valor)) && Number(valor) > 0;

// RF13_ Registro de gastos (validar que el monto y los datos vengan bien)
export const validarGasto = (body: any) => {
  const errores: string[] = [];

  if (!/^\d+(\.\d{1,2})?$/.test(String(body.monto ?? '')) || Number(body.monto) <= 0) {
    errores.push('El monto debe ser un número mayor a 0, con máximo 2 decimales.');
  } else if (Number(body.monto) > 9999999999.99) {
    errores.push('El monto es demasiado grande.');
  }

  // RF15_ Clasificación de gastos por categoría
  if (!esEnteroPositivo(body.categoria_id)) {
    errores.push('Selecciona una categoría.');
  }

  // RF16_ Registro de método de pago
  if (!esEnteroPositivo(body.metodo_pago_id) || !metodoPorId(Number(body.metodo_pago_id))) {
    errores.push('Selecciona un método de pago.');
  }

  let fecha: string | null = null;
  if (body.fecha !== undefined && body.fecha !== null && body.fecha !== '') {
    if (!esFechaValida(body.fecha)) {
      errores.push('La fecha no es válida (usa el formato AAAA-MM-DD).');
    } else if (body.fecha > fechaLocal(new Date())) {
      errores.push('La fecha del gasto no puede ser futura.');
    } else {
      fecha = body.fecha;
    }
  }

  let descripcion: string | null = null;
  if (body.descripcion !== undefined && body.descripcion !== null) {
    const texto = String(body.descripcion).trim();
    if (texto.length > 200) {
      errores.push('La descripción no puede pasar de 200 caracteres.');
    } else if (texto !== '') {
      descripcion = texto;
    }
  }

  return {
    errores,
    datos: {
      monto: Number(body.monto),
      categoria_id: Number(body.categoria_id),
      // en la base de datos se guarda el texto (gastos.metodo_de_pago)
      metodo_de_pago: metodoPorId(Number(body.metodo_pago_id))?.codigo ?? '',
      fecha,
      descripcion,
    },
  };
};

// RF17_ Consulta de gastos por periodo (si no mandan fechas, se toma el mes actual)
export const leerPeriodo = (query: any): { desde: string; hasta: string; error?: string } => {
  const hoy = new Date();
  const desde = query.desde ? String(query.desde) : fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const hasta = query.hasta ? String(query.hasta) : fechaLocal(hoy);

  if (!esFechaValida(desde) || !esFechaValida(hasta)) {
    return { desde, hasta, error: 'Las fechas del periodo no son válidas (usa AAAA-MM-DD).' };
  }
  if (desde > hasta) {
    return { desde, hasta, error: 'La fecha inicial no puede ser mayor a la final.' };
  }

  // RNF10_ Reportes de hasta un año: se limita el periodo a 366 días
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86400000;
  if (dias > 366) {
    return { desde, hasta, error: 'El periodo máximo de consulta es de un año.' };
  }

  return { desde, hasta };
};

// para los parametros que deben ser un id (numero entero positivo)
export const leerId = (valor: any): number | null => (esEnteroPositivo(valor) ? Number(valor) : null);
