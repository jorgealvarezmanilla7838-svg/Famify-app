// Validaciones del cuestionario de configuración de usuario (RF05 a RF08)
// RNF08_ se valida todo lo que llega del cliente antes de tocar la base de datos
// RNF21_ los mensajes dicen qué campo falló y cómo corregirlo
const esEntero = (valor: any) => /^\d+$/.test(String(valor ?? ''));
const esDia = (valor: any) => esEntero(valor) && Number(valor) >= 1 && Number(valor) <= 31;
const esMonto = (valor: any) => /^\d+(\.\d{1,2})?$/.test(String(valor ?? ''));
const MONTO_MAXIMO = 9999999999.99;

// catálogos que se consultan en la base de datos para validar los ids
export interface CatalogosValidacion {
  metodos: Map<number, { nombre: string; es_credito: boolean }>;
  categorias: Set<number>;
}

export interface MetodoPagoUsuario {
  metodo_pago_id: number;
  alias: string;
  dia_corte: number | null;
  dia_limite_pago: number | null;
}

export interface GastoFijoUsuario {
  descripcion: string;
  categoria_id: number;
  monto: number;
  dia_pago: number;
  dias_aviso: number;
}

export const validarConfiguracion = (body: any, catalogos: CatalogosValidacion) => {
  const errores: string[] = [];

  // RF05_ ¿recibe sueldo o no? (de esto dependen los permisos de ingresos)
  let recibeSueldo = false;
  if (typeof body?.recibe_sueldo !== 'boolean') {
    errores.push('Indica si recibes un sueldo o no.');
  } else {
    recibeSueldo = body.recibe_sueldo;
  }

  let ingresoPrincipal: number | null = null;
  let tieneSecundarios = false;
  let diasIngreso: number[] | null = null;

  if (recibeSueldo) {
    if (!esMonto(body.ingreso_principal) || Number(body.ingreso_principal) <= 0) {
      errores.push('El ingreso mensual principal debe ser un número mayor a 0, con máximo 2 decimales.');
    } else if (Number(body.ingreso_principal) > MONTO_MAXIMO) {
      errores.push('El ingreso mensual principal es demasiado grande.');
    } else {
      ingresoPrincipal = Number(body.ingreso_principal);
    }

    if (body.tiene_ingresos_secundarios !== undefined && typeof body.tiene_ingresos_secundarios !== 'boolean') {
      errores.push('Indica si tienes ingresos secundarios (sí o no).');
    } else {
      tieneSecundarios = body.tiene_ingresos_secundarios === true;
    }

    if (!Array.isArray(body.dias_ingreso) || body.dias_ingreso.length === 0) {
      errores.push('Selecciona al menos un día del mes en el que recibes tus ingresos.');
    } else if (body.dias_ingreso.length > 31 || !body.dias_ingreso.every(esDia)) {
      errores.push('Los días de ingreso deben ser números del 1 al 31.');
    } else {
      diasIngreso = [...new Set<number>(body.dias_ingreso.map(Number))].sort((a, b) => a - b);
    }
  }

  // RF06_ y RF07_ métodos de pago (la tarjeta de crédito lleva día de corte y día límite)
  // En la base de datos cada usuario guarda UN solo corte y UN solo límite de pago
  // (configuracion_financiera.dia_de_corte / fecha_limite_de_pago), por eso solo se
  // acepta una tarjeta de crédito y cada método de pago una sola vez.
  const metodos: MetodoPagoUsuario[] = [];
  if (!Array.isArray(body?.metodos_pago) || body.metodos_pago.length === 0) {
    errores.push('Selecciona al menos un método de pago.');
  } else if (body.metodos_pago.length > 20) {
    errores.push('Registraste demasiados métodos de pago.');
  } else {
    const vistos = new Set<number>();
    body.metodos_pago.forEach((m: any, i: number) => {
      const etiqueta = `Método de pago ${i + 1}:`;
      const id = Number(m?.metodo_pago_id);
      const metodo = catalogos.metodos.get(id);
      if (!esEntero(m?.metodo_pago_id) || !metodo) {
        errores.push(`${etiqueta} selecciona un método de pago válido.`);
        return;
      }
      if (vistos.has(id)) {
        errores.push(
          metodo.es_credito
            ? `${etiqueta} solo puedes registrar una tarjeta de crédito.`
            : `${etiqueta} el método "${metodo.nombre}" está repetido.`
        );
        return;
      }
      vistos.add(id);

      const alias = typeof m?.alias === 'string' ? m.alias.trim() : 'Principal';
      if (!alias || alias.length > 50) {
        errores.push(`${etiqueta} el alias debe tener entre 1 y 50 caracteres.`);
        return;
      }

      let diaCorte: number | null = null;
      let diaLimite: number | null = null;
      if (metodo.es_credito) {
        if (!esDia(m?.dia_corte)) {
          errores.push(`${etiqueta} el día de corte debe ser un número del 1 al 31.`);
        } else {
          diaCorte = Number(m.dia_corte);
        }
        if (!esDia(m?.dia_limite_pago)) {
          errores.push(`${etiqueta} el día límite de pago debe ser un número del 1 al 31.`);
        } else {
          diaLimite = Number(m.dia_limite_pago);
        }
      }
      metodos.push({ metodo_pago_id: id, alias, dia_corte: diaCorte, dia_limite_pago: diaLimite });
    });
  }

  // RF08_ gastos fijos (colegiaturas, transporte, alimentos, etc.). Puede no tener ninguno
  const gastosFijos: GastoFijoUsuario[] = [];
  const listaGastos = body?.gastos_fijos ?? [];
  if (!Array.isArray(listaGastos)) {
    errores.push('La lista de gastos fijos no es válida.');
  } else if (listaGastos.length > 30) {
    errores.push('Puedes registrar máximo 30 gastos fijos en el cuestionario.');
  } else {
    listaGastos.forEach((g: any, i: number) => {
      const etiqueta = `Gasto fijo ${i + 1}:`;
      const descripcion = String(g?.descripcion ?? '').trim();
      if (descripcion === '') {
        errores.push(`${etiqueta} escribe una descripción (por ejemplo "Colegiatura").`);
        return;
      }
      if (descripcion.length > 150) {
        errores.push(`${etiqueta} la descripción no puede pasar de 150 caracteres.`);
        return;
      }
      if (!esMonto(g?.monto) || Number(g.monto) <= 0) {
        errores.push(`${etiqueta} el monto debe ser un número mayor a 0, con máximo 2 decimales.`);
        return;
      }
      if (Number(g.monto) > MONTO_MAXIMO) {
        errores.push(`${etiqueta} el monto es demasiado grande.`);
        return;
      }
      if (!esEntero(g?.categoria_id) || !catalogos.categorias.has(Number(g.categoria_id))) {
        errores.push(`${etiqueta} selecciona una categoría.`);
        return;
      }
      if (!esDia(g?.dia_pago)) {
        errores.push(`${etiqueta} el día de pago debe ser un número del 1 al 31.`);
        return;
      }
      const diasAviso = g?.dias_aviso === undefined || g?.dias_aviso === '' ? 3 : g.dias_aviso;
      if (!esEntero(diasAviso) || Number(diasAviso) > 30) {
        errores.push(`${etiqueta} los días de aviso deben ser un número entre 0 y 30.`);
        return;
      }
      gastosFijos.push({
        descripcion,
        categoria_id: Number(g.categoria_id),
        monto: Number(g.monto),
        dia_pago: Number(g.dia_pago),
        dias_aviso: Number(diasAviso),
      });
    });
  }

  return {
    errores,
    datos: {
      recibe_sueldo: recibeSueldo,
      ingreso_principal: ingresoPrincipal,
      tiene_ingresos_secundarios: tieneSecundarios,
      dias_ingreso: diasIngreso,
      metodos,
      gastosFijos,
    },
  };
};
