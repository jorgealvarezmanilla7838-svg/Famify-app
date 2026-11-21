// Base de datos simulada: reemplaza pool.query y pool.connect por respuestas preparadas en cada prueba.
// Así se prueba la lógica del servidor sin PostgreSQL y se puede revisar qué consultas y parámetros se enviaron.
import { pool } from '../../src/db';

type Resultado = { rows?: any[]; rowCount?: number };
type Respuesta = Resultado | Error | ((params: any[], sql: string) => Resultado | Error | Promise<Resultado | Error>);

interface Regla {
  patron: string | RegExp;
  respuesta: Respuesta;
}

export interface Consulta {
  sql: string;
  params: any[];
}

const reglas: Regla[] = [];
const consultas: Consulta[] = [];
let transacciones: string[] = [];

const coincide = (patron: string | RegExp, sql: string) =>
  typeof patron === 'string' ? sql.includes(patron) : patron.test(sql);

const ejecutar = async (sql: string, params: any[] = []) => {
  const texto = String(sql);
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(texto)) {
    transacciones.push(texto.trim().toUpperCase());
    return { rows: [], rowCount: 0 };
  }
  consultas.push({ sql: texto, params });
  // La última regla agregada tiene prioridad (permite sobrescribir las de base en cada prueba)
  for (let i = reglas.length - 1; i >= 0; i -= 1) {
    const regla = reglas[i]!;
    if (!coincide(regla.patron, texto)) continue;
    const r = typeof regla.respuesta === 'function' ? await regla.respuesta(params, texto) : regla.respuesta;
    if (r instanceof Error) throw r;
    return { rows: r.rows ?? [], rowCount: r.rowCount ?? r.rows?.length ?? 0 };
  }
  throw new Error(`La prueba no preparó respuesta para la consulta: ${texto.replace(/\s+/g, ' ').slice(0, 120)}`);
};

(pool as any).query = ejecutar;
(pool as any).connect = async () => ({ query: ejecutar, release: () => undefined });

export const bd = {
  cuando(patron: string | RegExp, respuesta: Respuesta) {
    reglas.push({ patron, respuesta });
    return bd;
  },
  reiniciar() {
    reglas.length = 0;
    consultas.length = 0;
    transacciones = [];
  },
  consultas: () => [...consultas],
  buscar: (texto: string) => consultas.filter((c) => c.sql.includes(texto)),
  transacciones: () => [...transacciones],
};

// Error con el código que manda PostgreSQL (por ejemplo 23505 = registro duplicado)
export const errorBd = (codigo: string, mensaje = 'error de base de datos') =>
  Object.assign(new Error(mensaje), { code: codigo });

export interface UsuarioPrueba {
  id?: number;
  familia?: number | null;
  admin?: boolean;
  permisos?: string[] | 'todos';
  activo?: boolean;
}

// Prepara lo que consultan cargarContexto (RNF04) y exigirPermiso (RNF03)
export const prepararUsuario = ({ id = 1, familia = 10, admin = true, permisos = 'todos', activo = true }: UsuarioPrueba = {}) => {
  bd.cuando('LEFT JOIN rolfamiliar ro', () =>
    activo
      ? {
          rows: [
            {
              id,
              familia_id: familia,
              rol: admin ? 'administrador' : 'integrante',
              rol_familia_id: null,
              ver_detalle: admin || (permisos !== 'todos' && permisos.includes('gastos.ver_detalle')),
            },
          ],
        }
      : { rows: [] }
  );
  bd.cuando('SELECT fn_tiene_permiso($1::bigint, $2::text) AS ok', (params) => ({
    rows: [{ ok: permisos === 'todos' || permisos.includes(params[1]) }],
  }));
};
