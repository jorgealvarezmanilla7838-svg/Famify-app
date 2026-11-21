import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { mensajesDe } from './api';
import { hoy, inicioAnio, inicioMes, inicioSemana } from './formato';

// Piezas compartidas para que todas las pantallas se vean y se comporten igual (RNF19)

export const useAvisos = () => {
  const [errores, setErrores] = useState<string[]>([]);
  const [aviso, setAviso] = useState('');

  const limpiar = useCallback(() => {
    setErrores([]);
    setAviso('');
  }, []);
  const fallar = useCallback((err: unknown) => {
    setAviso('');
    setErrores(mensajesDe(err));
  }, []);
  const exito = useCallback((texto: string) => {
    setErrores([]);
    setAviso(texto);
  }, []);

  return { errores, aviso, limpiar, fallar, exito };
};

export const Avisos: FC<{ errores: string[]; aviso: string }> = ({ errores, aviso }) => (
  <>
    {errores.length > 0 && (
      <div className="modulo-mensaje modulo-mensaje--error" role="alert">
        {errores.length === 1 ? errores[0] : <ul>{errores.map((e) => <li key={e}>{e}</li>)}</ul>}
      </div>
    )}
    {aviso && <p className="modulo-mensaje modulo-mensaje--exito" role="status">{aviso}</p>}
  </>
);

// RNF23_ Las fechas se escriben y se muestran siempre como DD/MM/AAAA.
// El <input type="date"> del navegador usa el formato del idioma del sistema, por eso aquí se usa
// un campo de texto con máscara. El valor que recibe y entrega el componente sigue siendo AAAA-MM-DD.
const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoATexto = (iso: string) => (FECHA_ISO.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const textoAIso = (texto: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (!m) return null;
  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(anio, mes - 1, dia);
  const existe = f.getFullYear() === anio && f.getMonth() === mes - 1 && f.getDate() === dia;
  return existe ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

interface CampoFechaProps {
  value: string;
  onChange: (valor: string) => void;
  min?: string;
  max?: string;
  ariaLabel?: string;
  // En filtros solo se avisa al resto de la pantalla cuando la fecha está completa y es real
  filtro?: boolean;
}

export const CampoFecha: FC<CampoFechaProps> = ({ value, onChange, min, max, ariaLabel, filtro }) => {
  const [texto, setTexto] = useState(() => isoATexto(value));
  const calendario = useRef<HTMLInputElement>(null);

  // Si la pantalla cambia la fecha (por ejemplo con "Esta semana"), el texto se actualiza
  useEffect(() => {
    if (value !== '' && !FECHA_ISO.test(value)) return;
    setTexto((actual) => (textoAIso(actual) === value ? actual : isoATexto(value)));
  }, [value]);

  const cambiar = (nuevo: string) => {
    const d = nuevo.replace(/\D/g, '').slice(0, 8);
    const formateado = d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    setTexto(formateado);
    const iso = textoAIso(formateado);
    if (iso) onChange(iso);
    else if (formateado === '') onChange('');
    else if (!filtro) onChange(formateado); // el servidor la rechaza con un mensaje claro
  };

  const abrirCalendario = () => {
    try {
      calendario.current?.showPicker();
    } catch {
      calendario.current?.focus();
    }
  };

  const incompleta = texto.length === 10 && textoAIso(texto) === null;
  return (
    <span className="campo-fecha">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/AAAA"
        maxLength={10}
        value={texto}
        aria-label={ariaLabel}
        aria-invalid={incompleta || undefined}
        onChange={(e) => cambiar(e.target.value)}
      />
      <button type="button" className="campo-fecha-boton" aria-label="Elegir la fecha en el calendario" onClick={abrirCalendario}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>
      <input
        ref={calendario}
        type="date"
        className="campo-fecha-nativo"
        tabIndex={-1}
        aria-hidden="true"
        min={min}
        max={max}
        value={textoAIso(texto) ?? ''}
        onChange={(e) => {
          if (!e.target.value) return;
          setTexto(isoATexto(e.target.value));
          onChange(e.target.value);
        }}
      />
    </span>
  );
};

export const usePeriodo = () => {
  const [desde, setDesde] = useState(inicioMes);
  const [hasta, setHasta] = useState(hoy);
  return { desde, hasta, setDesde, setHasta };
};

type Periodo = ReturnType<typeof usePeriodo>;

export const SelectorPeriodo: FC<{ periodo: Periodo; titulo: string }> = ({ periodo, titulo }) => {
  const elegir = (inicio: () => string) => {
    periodo.setDesde(inicio());
    periodo.setHasta(hoy());
  };
  return (
    <>
      <div className="modulo-periodos" role="group" aria-label="Periodos frecuentes">
        <span>Consultar:</span>
        <button type="button" className="modulo-boton" onClick={() => elegir(inicioSemana)}>Esta semana</button>
        <button type="button" className="modulo-boton" onClick={() => elegir(inicioMes)}>Este mes</button>
        <button type="button" className="modulo-boton" onClick={() => elegir(inicioAnio)}>Este año</button>
      </div>
      <div className="modulo-filtros">
        <h4>{titulo}</h4>
        <label>
          Desde
          <CampoFecha filtro value={periodo.desde} max={periodo.hasta} onChange={periodo.setDesde} />
        </label>
        <label>
          Hasta
          <CampoFecha filtro value={periodo.hasta} min={periodo.desde} onChange={periodo.setHasta} />
        </label>
      </div>
    </>
  );
};

export type EstadoBarra = 'ok' | 'cerca' | 'excedido' | 'ingreso' | 'gasto';

export const Barra: FC<{ etiqueta: string; detalle: string; valor: number; maximo: number; estado?: EstadoBarra }> = ({
  etiqueta,
  detalle,
  valor,
  maximo,
  estado = 'ok',
}) => {
  const porcentaje = maximo > 0 ? Math.min(100, (valor / maximo) * 100) : 0;
  return (
    <div className="modulo-barra">
      <div className="modulo-barra-texto">
        <span>{etiqueta}</span>
        <strong>{detalle}</strong>
      </div>
      <div
        className="modulo-barra-pista"
        role="progressbar"
        aria-label={etiqueta}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(porcentaje)}
      >
        <div className={`modulo-barra-relleno modulo-barra-relleno--${estado}`} style={{ width: `${porcentaje}%` }} />
      </div>
    </div>
  );
};

export const Encabezado: FC<{ titulo: string; descripcion: string; icono: string }> = ({ titulo, descripcion, icono }) => (
  <header className="modulo-encabezado">
    <div>
      <h3>{titulo}</h3>
      <p>{descripcion}</p>
    </div>
    <span className="modulo-icono" aria-hidden="true">{icono}</span>
  </header>
);
