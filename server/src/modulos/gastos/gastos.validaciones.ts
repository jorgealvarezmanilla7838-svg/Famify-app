export const validarGasto = (body: any) => {
  const errores: string[] = [];

  const monto = Number(body?.monto);
  if (isNaN(monto) || monto <= 0) {
    errores.push('El monto debe ser mayor a 0.');
  }

  const categoria_id = Number(body?.categoria_id);
  if (isNaN(categoria_id) || categoria_id <= 0) {
    errores.push('Selecciona una categoría válida.');
  }

  // Aceptar tanto el string del catálogo como id numérico o nulo
  const metodo_pago_id = body?.metodo_pago_id || body?.metodo_de_pago;
  const metodosValidos = ['efectivo', 'tarjeta_debito', 'tarjeta_credito', 'otro'];

  if (!metodo_pago_id || (!metodosValidos.includes(String(metodo_pago_id)) && isNaN(Number(metodo_pago_id)))) {
    errores.push('Selecciona un método de pago.');
  }

  return {
    errores,
    datos: {
      monto,
      categoria_id,
      metodo_pago_id: String(metodo_pago_id),
      descripcion: typeof body?.descripcion === 'string' ? body.descripcion.trim() : '',
      fecha: body?.fecha || null,
    },
  };
};

// Auxiliar para parsear y validar rangos de fecha en consultas GET (RF17/RF18)
export const leerPeriodo = (query: any) => {
  const hoy = new Date().toISOString().split('T')[0];
  const primerDiaMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const desde = typeof query?.desde === 'string' && query.desde.trim() !== '' ? query.desde : primerDiaMes;
  const hasta = typeof query?.hasta === 'string' && query.hasta.trim() !== '' ? query.hasta : hoy;

  if (desde > hasta) {
    return { error: 'La fecha "desde" no puede ser posterior a la fecha "hasta".', desde, hasta };
  }

  return { error: null, desde, hasta };
};

// Auxiliar para validar IDs numéricos en parámetros de URL o query
export const leerId = (id: any): number | null => {
  const num = Number(id);
  return !isNaN(num) && num > 0 ? num : null;
};

// Fecha local en formato AAAA-MM-DD (toISOString usaría UTC y puede dar el día siguiente)
export const fechaLocal = (d: Date): string => {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
};

// true si el texto es una fecha real con formato AAAA-MM-DD (también las usa ingresos.validaciones.ts)
export const esFechaValida = (valor: any): boolean => {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [anio = 0, mes = 0, dia = 0] = valor.split('-').map(Number);
  const f = new Date(anio, mes - 1, dia);
  return f.getFullYear() === anio && f.getMonth() === mes - 1 && f.getDate() === dia;
};
