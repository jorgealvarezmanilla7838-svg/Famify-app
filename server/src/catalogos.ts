// Métodos de pago (RF06 / RF16)
// En la base de datos ya no existe la tabla metodos_pago: ahora son valores fijos
// (CHECK en gastos.metodo_de_pago y configuracion_financiera.metodos_de_pago).
// Aquí se guardan los mismos valores con un id numérico para que el cliente
// siga trabajando con ids como antes.
export interface MetodoPago {
  id: number;
  codigo: 'efectivo' | 'tarjeta_debito' | 'tarjeta_credito' | 'otro';
  nombre: string;
  es_credito: boolean;
}

export const METODOS_PAGO: MetodoPago[] = [
  { id: 1, codigo: 'efectivo', nombre: 'Efectivo', es_credito: false },
  { id: 2, codigo: 'tarjeta_debito', nombre: 'Tarjeta de débito', es_credito: false },
  { id: 3, codigo: 'tarjeta_credito', nombre: 'Tarjeta de crédito', es_credito: true },
  { id: 4, codigo: 'otro', nombre: 'Otro', es_credito: false },
];

export const metodoPorId = (id: number) => METODOS_PAGO.find((m) => m.id === id);
export const metodoPorCodigo = (codigo: string) => METODOS_PAGO.find((m) => m.codigo === codigo);
