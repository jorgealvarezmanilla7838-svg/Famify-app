// RNF23_ Montos en MXN con separador de miles y dos decimales, fechas DD/MM/AAAA
const formatoMxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const moneda = (monto: string | number) => formatoMxn.format(Number(monto));

export const fechaVisible = (fecha: string | null | undefined) => {
  if (!fecha) return '';
  const [anio, mes, dia] = fecha.slice(0, 10).split('-');
  return `${dia}/${mes}/${anio}`;
};

export const fechaLocal = (fecha: Date) =>
  `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;

export const hoy = () => fechaLocal(new Date());
export const inicioMes = () => `${hoy().slice(0, 7)}-01`;
export const inicioAnio = () => `${hoy().slice(0, 4)}-01-01`;
export const inicioSemana = () => {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - ((fecha.getDay() + 6) % 7));
  return fechaLocal(fecha);
};
export const finMes = () => {
  const ahora = new Date();
  return fechaLocal(new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0));
};
