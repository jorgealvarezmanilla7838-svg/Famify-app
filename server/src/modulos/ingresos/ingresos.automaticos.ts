import { pool } from '../../db';

// RF05_ y RF09_ El ingreso mensual de "Mi configuración" se registra solo como ingreso en cada día de ingreso del mes.
// Si hay varios días de ingreso, el monto mensual se reparte entre ellos.
// No se agregan tablas ni columnas: los ingresos automáticos se reconocen por su fuente.
export const FUENTE_SUELDO_AUTOMATICO = 'Sueldo mensual (automático)';

const ZONA_HORARIA = 'America/Mexico_City';
const REVISION_CADA_MS = 10 * 60 * 1000;

// Ingresos ya revisados en este mes: uno borrado a mano no se vuelve a crear hasta reiniciar el servidor
// o guardar otra vez la configuración
const revisados = new Set<string>();
let mesRevisado = '';
let cola: Promise<unknown> = Promise.resolve();

// Reparte el ingreso mensual entre los días de ingreso; el último día recibe el sobrante para que el total sea exacto.
// Los días 29, 30 y 31 se ajustan al último día de los meses más cortos.
export const calcularIngresosDelMes = (
  ingresoPrincipal: string | number,
  diasDeIngreso: number[],
  anio: number,
  mes: number
) => {
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const dias = [...new Set(diasDeIngreso.map((d) => Math.min(Number(d), ultimoDia)))].sort((a, b) => a - b);
  const centavos = Math.round(Number(ingresoPrincipal) * 100);
  if (dias.length === 0 || centavos < dias.length) return [];

  const parte = Math.floor(centavos / dias.length);
  return dias.map((dia, i) => ({
    dia,
    monto: (i === dias.length - 1 ? centavos - parte * (dias.length - 1) : parte) / 100,
  }));
};

const sincronizar = async (usuarioId: number | null, actualizarMontos: boolean) => {
  const ahora = await pool.query(`SELECT to_char(now() AT TIME ZONE $1::text, 'YYYY-MM-DD') AS hoy`, [ZONA_HORARIA]);
  const hoy: string = ahora.rows[0].hoy;
  const [anio, mes, diaHoy] = hoy.split('-').map(Number) as [number, number, number];

  if (hoy.slice(0, 7) !== mesRevisado) {
    revisados.clear();
    mesRevisado = hoy.slice(0, 7);
  }

  // RF05_ Solo quien recibe sueldo y tiene el permiso ingresos.registrar (lo mismo que exige el trigger de la base)
  const usuarios = await pool.query(
    `SELECT u.id, u.familia_id, cf.ingreso_principal, cf.dias_de_ingreso
       FROM usuario u
       JOIN configuracion_financiera cf ON cf.usuario_id = u.id
      WHERE u.activo AND u.recibe_sueldo AND u.familia_id IS NOT NULL
        AND cf.ingreso_principal > 0
        AND COALESCE(array_length(cf.dias_de_ingreso, 1), 0) > 0
        AND fn_tiene_permiso(u.id, 'ingresos.registrar')
        AND ($1::bigint IS NULL OR u.id = $1::bigint)`,
    [usuarioId]
  );

  for (const usuario of usuarios.rows) {
    const ingresos = calcularIngresosDelMes(usuario.ingreso_principal, usuario.dias_de_ingreso, anio, mes);

    for (const { dia, monto } of ingresos) {
      const fecha = `${hoy.slice(0, 8)}${String(dia).padStart(2, '0')}`;
      const clave = `${usuario.id}|${fecha}`;

      // Al guardar la configuración, el ingreso automático de este mes toma el monto nuevo
      if (actualizarMontos) {
        await pool.query(
          `UPDATE ingresos SET monto = $4::numeric
            WHERE usuario_id = $1::bigint AND fuente = $2::varchar AND fecha = $3::date AND monto <> $4::numeric`,
          [usuario.id, FUENTE_SUELDO_AUTOMATICO, fecha, monto]
        );
      }

      if (dia > diaHoy || (!actualizarMontos && revisados.has(clave))) continue;

      await pool.query(
        `INSERT INTO ingresos (familia_id, usuario_id, monto, fuente, tipo_de_ingreso, periodicidad, fecha)
         SELECT $1::bigint, $2::bigint, $3::numeric, $4::varchar, 'salario', 'mensual', $5::date
          WHERE NOT EXISTS (SELECT 1 FROM ingresos
                             WHERE usuario_id = $2::bigint AND fuente = $4::varchar AND fecha = $5::date)`,
        [usuario.familia_id, usuario.id, monto, FUENTE_SUELDO_AUTOMATICO, fecha]
      );
      revisados.add(clave);
    }
  }
};

// Las ejecuciones se hacen una tras otra para no crear el mismo ingreso dos veces
export const registrarSueldoAutomatico = (usuarioId: number | null = null, actualizarMontos = false) => {
  const turno = cola.then(() => sincronizar(usuarioId, actualizarMontos));
  cola = turno.catch(() => undefined);
  return turno;
};

// Se llama una sola vez al arrancar el servidor: pone al día lo que haya pasado mientras estuvo apagado
export const iniciarIngresosAutomaticos = () => {
  const revisar = () =>
    registrarSueldoAutomatico().catch((err: any) => {
      console.error('Error al registrar los ingresos automáticos:', err.message);
    });
  void revisar();
  setInterval(() => void revisar(), REVISION_CADA_MS);
};
