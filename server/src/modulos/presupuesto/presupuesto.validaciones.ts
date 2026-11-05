import { fechaLocal } from '../gastos/gastos.validaciones';

// Módulo 5 - Presupuesto familiar: validaciones de lo que manda el cliente

const MONTO_MAXIMO = 9999999999.99;
const esMonto = (valor: any) => /^\d+(\.\d{1,2})?$/.test(String(valor ?? ''));

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// RF19_ El presupuesto es por mes: de AAAA-MM saca el primer y el último día
export const leerMes = (valor: any) => {
  const mes = typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : fechaLocal(new Date()).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return null;

  const [anio = 0, numeroMes = 0] = mes.split('-').map(Number);
  const ultimoDia = new Date(anio, numeroMes, 0).getDate();
  return {
    mes,
    inicio: `${mes}-01`,
    fin: `${mes}-${String(ultimoDia).padStart(2, '0')}`,
    periodo: `${MESES[numeroMes - 1] ?? ''} ${anio}`,
  };
};

// RF19_ Validar monto total del presupuesto y el porcentaje de alerta (RF22)
export const validarPresupuesto = (body: any) => {
  const errores: string[] = [];

  const montoTotal = Number(body?.monto_total);
  if (!esMonto(body?.monto_total) || montoTotal <= 0) {
    errores.push('El presupuesto debe ser un monto mayor a 0, con máximo 2 decimales.');
  } else if (montoTotal > MONTO_MAXIMO) {
    errores.push('El monto del presupuesto es demasiado grande.');
  }

  const sinUmbral = body?.umbral_alerta === undefined || body?.umbral_alerta === null || body?.umbral_alerta === '';
  const umbral = sinUmbral ? 80 : Number(body.umbral_alerta);
  if (!Number.isFinite(umbral) || umbral < 1 || umbral > 100) {
    errores.push('El porcentaje de alerta debe estar entre 1 y 100.');
  }

  return { errores, datos: { monto_total: montoTotal, umbral_alerta: umbral } };
};

// RF20_ Validar la lista de montos por categoría (los que vienen en 0 o vacíos no se guardan)
export const validarCategorias = (body: any) => {
  const errores: string[] = [];
  const asignaciones: { categoria_id: number; monto_asignado: number }[] = [];

  if (!Array.isArray(body?.categorias)) {
    return { errores: ['Envía la lista de categorías con su monto.'], asignaciones };
  }

  const vistas = new Set<number>();
  for (const c of body.categorias) {
    const categoriaId = Number(c?.categoria_id);
    if (!Number.isInteger(categoriaId) || categoriaId <= 0) {
      errores.push('Hay una categoría que no es válida.');
      continue;
    }
    if (vistas.has(categoriaId)) {
      errores.push('Una categoría viene repetida.');
      continue;
    }
    vistas.add(categoriaId);

    const texto = String(c?.monto_asignado ?? '').trim();
    if (texto === '' || Number(texto) === 0) continue;

    if (!esMonto(texto) || Number(texto) <= 0 || Number(texto) > MONTO_MAXIMO) {
      errores.push('Los montos por categoría deben ser mayores a 0, con máximo 2 decimales.');
      continue;
    }
    asignaciones.push({ categoria_id: categoriaId, monto_asignado: Number(texto) });
  }

  return { errores, asignaciones };
};
