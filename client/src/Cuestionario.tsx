import { useEffect, useState } from 'react';
import type { FC, FormEvent } from 'react';
import './Cuestionario.css';

// Cuestionario de configuración de usuario (RF05 a RF08)
// Lo contestan tanto el administrador como los integrantes nuevos para completar su registro (RF04)

const API = 'http://localhost:4000';

interface MetodoCatalogo {
  id: number;
  nombre: string;
  es_credito: boolean;
}
interface CategoriaCatalogo {
  id: number;
  nombre: string;
}
interface Tarjeta {
  alias: string;
  dia_corte: string;
  dia_limite_pago: string;
}
interface GastoFijo {
  descripcion: string;
  categoria_id: string;
  monto: string;
  dia_pago: string;
  dias_aviso: string;
}

interface Props {
  nombre: string;
  onCompletado: (datos: { recibe_sueldo: boolean }) => void;
}

// atajos para los gastos fijos más comunes (RF08)
const ATAJOS = [
  { texto: 'Colegiatura', categoria: 'Educación' },
  { texto: 'Transporte', categoria: 'Transporte' },
  { texto: 'Alimentos', categoria: 'Alimentos' },
  { texto: 'Servicios (luz, agua, internet)', categoria: 'Servicios' },
  { texto: 'Renta', categoria: 'Hogar' },
];

const cabeceras = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const montoValido = (t: string) => /^\d+(\.\d{1,2})?$/.test(t.trim()) && Number(t) > 0;
const diaValido = (t: string) => /^\d+$/.test(t.trim()) && Number(t) >= 1 && Number(t) <= 31;
const avisoValido = (t: string) => /^\d+$/.test(t.trim()) && Number(t) <= 30;

const tarjetaVacia = (): Tarjeta => ({ alias: '', dia_corte: '', dia_limite_pago: '' });
const gastoVacio = (): GastoFijo => ({ descripcion: '', categoria_id: '', monto: '', dia_pago: '', dias_aviso: '3' });

type Paso = 'ingresos' | 'metodos' | 'tarjetas' | 'gastos';

export const Cuestionario: FC<Props> = ({ nombre, onCompletado }) => {
  const [metodosCat, setMetodosCat] = useState<MetodoCatalogo[]>([]);
  const [categoriasCat, setCategoriasCat] = useState<CategoriaCatalogo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');

  // RF05
  const [recibeSueldo, setRecibeSueldo] = useState<boolean | null>(null);
  const [ingresoPrincipal, setIngresoPrincipal] = useState('');
  const [tieneSecundarios, setTieneSecundarios] = useState(false);
  const [diasIngreso, setDiasIngreso] = useState<number[]>([]);
  // RF06 y RF07
  const [metodosSel, setMetodosSel] = useState<number[]>([]);
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([]);
  // RF08
  const [gastos, setGastos] = useState<GastoFijo[]>([]);

  const [indice, setIndice] = useState(0);
  const [errores, setErrores] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    const cargar = async () => {
      try {
        const res = await fetch(`${API}/api/configuracion/catalogos`, { headers: cabeceras() });
        const data = await res.json();
        if (!res.ok) {
          setErrorCarga(data.error || 'No se pudo cargar el cuestionario.');
        } else {
          setMetodosCat(data.metodos_pago);
          setCategoriasCat(data.categorias);
        }
      } catch {
        setErrorCarga('Error de conexión con el servidor backend.');
      } finally {
        setCargando(false);
      }
    };
    cargar();
  }, []);

  const metodoCredito = metodosCat.find((m) => m.es_credito);
  const usaCredito = metodoCredito ? metodosSel.includes(metodoCredito.id) : false;

  // el paso de tarjetas solo aparece si eligió tarjeta de crédito
  const pasos: Paso[] = ['ingresos', 'metodos', ...(usaCredito ? (['tarjetas'] as Paso[]) : []), 'gastos'];
  const paso = pasos[Math.min(indice, pasos.length - 1)] as Paso;
  const esUltimo = indice >= pasos.length - 1;

  const alternarMetodo = (id: number) => {
    const quitando = metodosSel.includes(id);
    setMetodosSel(quitando ? metodosSel.filter((m) => m !== id) : [...metodosSel, id]);
    if (!quitando && metodoCredito?.id === id && tarjetas.length === 0) {
      setTarjetas([tarjetaVacia()]);
    }
  };

  const alternarDia = (dia: number) => {
    setDiasIngreso(diasIngreso.includes(dia) ? diasIngreso.filter((d) => d !== dia) : [...diasIngreso, dia].sort((a, b) => a - b));
  };

  const cambiarTarjeta = (i: number, campo: keyof Tarjeta, valor: string) =>
    setTarjetas(tarjetas.map((t, k) => (k === i ? { ...t, [campo]: valor } : t)));

  const cambiarGasto = (i: number, campo: keyof GastoFijo, valor: string) =>
    setGastos(gastos.map((g, k) => (k === i ? { ...g, [campo]: valor } : g)));

  const agregarAtajo = (texto: string, categoria: string) => {
    const cat = categoriasCat.find((c) => c.nombre.toLowerCase() === categoria.toLowerCase());
    setGastos([...gastos, { ...gastoVacio(), descripcion: texto, categoria_id: cat ? String(cat.id) : '' }]);
  };

  // mismas reglas que el servidor para avisar los errores antes de enviar (RNF21)
  const validarPaso = (p: Paso): string[] => {
    const e: string[] = [];
    if (p === 'ingresos') {
      if (recibeSueldo === null) e.push('Indica si recibes un sueldo o no.');
      if (recibeSueldo) {
        if (!montoValido(ingresoPrincipal)) e.push('Escribe tu ingreso mensual principal (un número mayor a 0, con máximo 2 decimales).');
        if (diasIngreso.length === 0) e.push('Selecciona al menos un día del mes en el que recibes tus ingresos.');
      }
    }
    if (p === 'metodos' && metodosSel.length === 0) {
      e.push('Selecciona al menos un método de pago.');
    }
    if (p === 'tarjetas') {
      if (tarjetas.length === 0) e.push('Agrega al menos una tarjeta de crédito.');
      tarjetas.forEach((t, i) => {
        if (!diaValido(t.dia_corte)) e.push(`Tarjeta ${i + 1}: el día de corte debe ser un número del 1 al 31.`);
        if (!diaValido(t.dia_limite_pago)) e.push(`Tarjeta ${i + 1}: el día límite de pago debe ser un número del 1 al 31.`);
      });
    }
    if (p === 'gastos') {
      gastos.forEach((g, i) => {
        const n = `Gasto fijo ${i + 1}:`;
        if (g.descripcion.trim() === '') e.push(`${n} escribe una descripción.`);
        if (g.categoria_id === '') e.push(`${n} selecciona una categoría.`);
        if (!montoValido(g.monto)) e.push(`${n} el monto debe ser un número mayor a 0, con máximo 2 decimales.`);
        if (!diaValido(g.dia_pago)) e.push(`${n} el día de pago debe ser un número del 1 al 31.`);
        if (!avisoValido(g.dias_aviso)) e.push(`${n} los días de aviso deben ser un número entre 0 y 30.`);
      });
    }
    return e;
  };

  const finalizar = async () => {
    const sinCredito = metodosSel.filter((id) => id !== metodoCredito?.id);
    const body = {
      recibe_sueldo: recibeSueldo === true,
      ingreso_principal: recibeSueldo ? Number(ingresoPrincipal) : null,
      tiene_ingresos_secundarios: recibeSueldo ? tieneSecundarios : false,
      dias_ingreso: recibeSueldo ? diasIngreso : null,
      metodos_pago: [
        ...sinCredito.map((id) => ({ metodo_pago_id: id })),
        ...(usaCredito && metodoCredito
          ? tarjetas.slice(0, 1).map((t) => ({
              metodo_pago_id: metodoCredito.id,
              alias: t.alias.trim() || 'Principal',
              dia_corte: Number(t.dia_corte),
              dia_limite_pago: Number(t.dia_limite_pago),
            }))
          : []),
      ],
      gastos_fijos: gastos.map((g) => ({
        descripcion: g.descripcion.trim(),
        categoria_id: Number(g.categoria_id),
        monto: Number(g.monto),
        dia_pago: Number(g.dia_pago),
        dias_aviso: Number(g.dias_aviso),
      })),
    };

    setEnviando(true);
    try {
      const res = await fetch(`${API}/api/configuracion/completar`, {
        method: 'POST',
        headers: cabeceras(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrores(data.errores && data.errores.length > 0 ? data.errores : [data.error]);
        return;
      }
      onCompletado({ recibe_sueldo: recibeSueldo === true });
    } catch {
      setErrores(['Error de conexión con el servidor backend.']);
    } finally {
      setEnviando(false);
    }
  };

  const manejarEnvio = (e: FormEvent) => {
    e.preventDefault();
    const e1 = validarPaso(paso);
    setErrores(e1);
    if (e1.length > 0) return;
    if (esUltimo) {
      finalizar();
    } else {
      setIndice(indice + 1);
    }
  };

  const atras = () => {
    setErrores([]);
    setIndice(Math.max(0, indice - 1));
  };

  if (cargando) return <p className="cuestionario-nota">Cargando cuestionario...</p>;
  if (errorCarga) return <div className="alert-box alert-error">{errorCarga}</div>;

  const titulos: Record<Paso, string> = {
    ingresos: 'Tus ingresos',
    metodos: 'Métodos de pago',
    tarjetas: 'Tarjetas de crédito',
    gastos: 'Gastos fijos',
  };

  return (
    <form onSubmit={manejarEnvio} className="cuestionario">
      <div className="cuestionario-encabezado">
        <h3>Completa tu registro{nombre ? `, ${nombre.split(' ')[0]}` : ''}</h3>
        <p className="cuestionario-nota">
          Unas preguntas rápidas sobre cómo manejas tu dinero. Con esto Famify te manda recordatorios y arma tus resúmenes.
        </p>
        <div className="cuestionario-progreso" aria-label={`Paso ${indice + 1} de ${pasos.length}`}>
          {pasos.map((p, i) => (
            <div key={p} className={`cuestionario-barra ${i <= indice ? 'activa' : ''}`} />
          ))}
        </div>
        <span className="cuestionario-paso">
          Paso {indice + 1} de {pasos.length}: {titulos[paso]}
        </span>
      </div>

      {errores.length > 0 && (
        <div className="alert-box alert-error" role="alert">
          <ul className="cuestionario-errores">
            {errores.map((er, i) => (
              <li key={i}>{er}</li>
            ))}
          </ul>
        </div>
      )}

      {/* RF05: ¿recibes sueldo? + ingreso principal, ingresos secundarios y días de ingreso */}
      {paso === 'ingresos' && (
        <div className="cuestionario-seccion">
          <div className="form-group">
            <label>¿Recibes un sueldo?</label>
            <div className="opciones-fila">
              <button
                type="button"
                className={`opcion ${recibeSueldo === true ? 'sel' : ''}`}
                aria-pressed={recibeSueldo === true}
                onClick={() => setRecibeSueldo(true)}
              >
                Sí
              </button>
              <button
                type="button"
                className={`opcion ${recibeSueldo === false ? 'sel' : ''}`}
                aria-pressed={recibeSueldo === false}
                onClick={() => setRecibeSueldo(false)}
              >
                No
              </button>
            </div>
          </div>

          {recibeSueldo === false && (
            <p className="cuestionario-aviso">
              Sin sueldo no vas a poder registrar ingresos en Famify, pero sí gastos, metas de ahorro y reportes. Si después
              eso cambia, el administrador puede ajustar tus permisos.
            </p>
          )}

          {recibeSueldo === true && (
            <>
              <div className="form-group">
                <label htmlFor="ingreso-principal">¿Cuánto ganas al mes? (ingreso principal, en pesos)</label>
                <input
                  id="ingreso-principal"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="form-input"
                  placeholder="Ej. 12000.00"
                  value={ingresoPrincipal}
                  onChange={(e) => setIngresoPrincipal(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>¿Tienes ingresos secundarios? (otro trabajo, tanda, ventas, etc.)</label>
                <div className="opciones-fila">
                  <button
                    type="button"
                    className={`opcion ${tieneSecundarios ? 'sel' : ''}`}
                    aria-pressed={tieneSecundarios}
                    onClick={() => setTieneSecundarios(true)}
                  >
                    Sí
                  </button>
                  <button
                    type="button"
                    className={`opcion ${!tieneSecundarios ? 'sel' : ''}`}
                    aria-pressed={!tieneSecundarios}
                    onClick={() => setTieneSecundarios(false)}
                  >
                    No
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>¿Qué días del mes recibes tus ingresos? (puedes elegir varios)</label>
                <div className="dias-grid">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`dia ${diasIngreso.includes(d) ? 'sel' : ''}`}
                      aria-pressed={diasIngreso.includes(d)}
                      onClick={() => alternarDia(d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* RF06: menú de métodos de pago */}
      {paso === 'metodos' && (
        <div className="cuestionario-seccion">
          <div className="form-group">
            <label>¿Qué métodos de pago usas normalmente? (elige uno o varios)</label>
            <div className="metodos-lista">
              {metodosCat.map((m) => (
                <label key={m.id} className={`metodo ${metodosSel.includes(m.id) ? 'sel' : ''}`}>
                  <input type="checkbox" checked={metodosSel.includes(m.id)} onChange={() => alternarMetodo(m.id)} />
                  <span>{m.nombre}</span>
                </label>
              ))}
            </div>
          </div>
          <p className="cuestionario-nota">Nunca te pedimos el número de tu tarjeta ni el código de seguridad.</p>
        </div>
      )}

      {/* RF07: día de corte y fecha límite de pago de cada tarjeta de crédito */}
      {paso === 'tarjetas' && (
        <div className="cuestionario-seccion">
          <p className="cuestionario-nota">
            Escribe el día del mes de tu corte y el día límite para pagar. Con esto te avisamos antes de que venza. Se registra una
            sola tarjeta de crédito.
          </p>
          {tarjetas.map((t, i) => (
            <div key={i} className="fila-tarjeta">
              <div className="fila-dos">
                <div className="form-group">
                  <label htmlFor={`corte-${i}`}>Día de corte</label>
                  <input
                    id={`corte-${i}`}
                    type="number"
                    min="1"
                    max="31"
                    className="form-input"
                    placeholder="1 a 31"
                    value={t.dia_corte}
                    onChange={(e) => cambiarTarjeta(i, 'dia_corte', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor={`limite-${i}`}>Día límite de pago</label>
                  <input
                    id={`limite-${i}`}
                    type="number"
                    min="1"
                    max="31"
                    className="form-input"
                    placeholder="1 a 31"
                    value={t.dia_limite_pago}
                    onChange={(e) => cambiarTarjeta(i, 'dia_limite_pago', e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* RF08: gastos fijos asignados */}
      {paso === 'gastos' && (
        <div className="cuestionario-seccion">
          <p className="cuestionario-nota">
            ¿Tienes pagos que haces cada mes, como colegiatura, transporte, alimentos o servicios? Agrégalos para que Famify te
            los recuerde. Si no tienes ninguno, puedes finalizar así.
          </p>

          <div className="atajos">
            {ATAJOS.map((a) => (
              <button key={a.texto} type="button" className="chip" onClick={() => agregarAtajo(a.texto, a.categoria)}>
                + {a.texto}
              </button>
            ))}
            <button type="button" className="chip" onClick={() => setGastos([...gastos, gastoVacio()])}>
              + Otro gasto
            </button>
          </div>

          {gastos.map((g, i) => (
            <div key={i} className="fila-tarjeta">
              <div className="form-group">
                <label htmlFor={`gdesc-${i}`}>Descripción</label>
                <input
                  id={`gdesc-${i}`}
                  type="text"
                  maxLength={150}
                  className="form-input"
                  placeholder="Ej. Colegiatura de mi hermano"
                  value={g.descripcion}
                  onChange={(e) => cambiarGasto(i, 'descripcion', e.target.value)}
                />
              </div>
              <div className="fila-dos">
                <div className="form-group">
                  <label htmlFor={`gcat-${i}`}>Categoría</label>
                  <select
                    id={`gcat-${i}`}
                    className="form-input"
                    value={g.categoria_id}
                    onChange={(e) => cambiarGasto(i, 'categoria_id', e.target.value)}
                  >
                    <option value="">Selecciona...</option>
                    {categoriasCat.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor={`gmonto-${i}`}>Monto (pesos)</label>
                  <input
                    id={`gmonto-${i}`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    className="form-input"
                    placeholder="0.00"
                    value={g.monto}
                    onChange={(e) => cambiarGasto(i, 'monto', e.target.value)}
                  />
                </div>
              </div>
              <div className="fila-dos">
                <div className="form-group">
                  <label htmlFor={`gdia-${i}`}>Día de pago del mes</label>
                  <input
                    id={`gdia-${i}`}
                    type="number"
                    min="1"
                    max="31"
                    className="form-input"
                    placeholder="1 a 31"
                    value={g.dia_pago}
                    onChange={(e) => cambiarGasto(i, 'dia_pago', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor={`gaviso-${i}`}>Avisarme (días antes)</label>
                  <input
                    id={`gaviso-${i}`}
                    type="number"
                    min="0"
                    max="30"
                    className="form-input"
                    value={g.dias_aviso}
                    onChange={(e) => cambiarGasto(i, 'dias_aviso', e.target.value)}
                  />
                </div>
              </div>
              <button type="button" className="btn-link-chico" onClick={() => setGastos(gastos.filter((_, k) => k !== i))}>
                Quitar este gasto
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="cuestionario-botones">
        {indice > 0 && (
          <button type="button" className="btn-secondary" onClick={atras} disabled={enviando}>
            Atrás
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={enviando}>
          {esUltimo ? (enviando ? 'Guardando...' : 'Finalizar registro') : 'Siguiente'}
        </button>
      </div>
    </form>
  );
};
