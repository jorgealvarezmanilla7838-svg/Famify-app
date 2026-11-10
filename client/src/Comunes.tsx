import { useCallback, useState, type FC } from 'react';
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
          <input type="date" value={periodo.desde} max={periodo.hasta} onChange={(e) => periodo.setDesde(e.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={periodo.hasta} min={periodo.desde} onChange={(e) => periodo.setHasta(e.target.value)} />
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
