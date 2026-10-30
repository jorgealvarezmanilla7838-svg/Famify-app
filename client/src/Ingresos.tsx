import { useCallback, useEffect, useState, type FormEvent } from 'react';
import './Ingresos.css';

type TipoIngreso = 'salario' | 'tanda' | 'prestamo' | 'otro';
type Periodicidad = 'unico' | 'semanal' | 'quincenal' | 'mensual' | 'anual';

interface Ingreso {
  id: string;
  fecha: string;
  monto: string | number;
  fuente: string;
  tipo: TipoIngreso;
  periodicidad: Periodicidad;
  es_mio: boolean;
}

interface RespuestaIngresos {
  ingresos: Ingreso[];
  total: string | number;
  cantidad: number;
  alcance: 'personal';
}

interface FormIngreso {
  monto: string;
  fuente: string;
  tipo: TipoIngreso;
  periodicidad: Periodicidad;
  fecha: string;
}

const fechaLocal = (fecha: Date) =>
  `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;

const hoyLocal = () => fechaLocal(new Date());

const inicioMes = () => `${hoyLocal().slice(0, 7)}-01`;
const inicioSemana = () => {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - ((fecha.getDay() + 6) % 7));
  return fechaLocal(fecha);
};
const inicioAnio = () => `${hoyLocal().slice(0, 4)}-01-01`;
const nuevoIngreso = (): FormIngreso => ({
  monto: '',
  fuente: '',
  tipo: 'salario',
  periodicidad: 'mensual',
  fecha: hoyLocal(),
});

const etiquetasTipo: Record<TipoIngreso, string> = {
  salario: 'Salario',
  tanda: 'Tanda',
  prestamo: 'Préstamo',
  otro: 'Otro',
};

const etiquetasPeriodicidad: Record<Periodicidad, string> = {
  unico: 'Único',
  semanal: 'Semanal',
  quincenal: 'Quincenal',
  mensual: 'Mensual',
  anual: 'Anual',
};

const formatoMoneda = (monto: string | number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(monto));

export const Ingresos = () => {
  const [desde, setDesde] = useState(inicioMes);
  const [hasta, setHasta] = useState(hoyLocal);
  const [datos, setDatos] = useState<RespuestaIngresos | null>(null);
  const [formulario, setFormulario] = useState<FormIngreso>(nuevoIngreso);
  const [editando, setEditando] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargarIngresos = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(
        `http://localhost:4000/api/ingresos?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const respuesta = await res.json();
      if (!res.ok) throw new Error(respuesta.error || 'No se pudieron consultar los ingresos.');
      setDatos(respuesta);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron consultar los ingresos.');
    } finally {
      setCargando(false);
    }
  }, [desde, hasta]);

  const seleccionarPeriodo = (periodo: 'semana' | 'mes' | 'anio') => {
    const inicios = {
      semana: inicioSemana,
      mes: inicioMes,
      anio: inicioAnio,
    };
    setError('');
    setCargando(true);
    setDesde(inicios[periodo]());
    setHasta(hoyLocal());
  };

  useEffect(() => {
    void Promise.resolve().then(cargarIngresos);
  }, [cargarIngresos]);

  const cancelarEdicion = () => {
    setEditando(null);
    setFormulario(nuevoIngreso());
  };

  const guardarIngreso = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setAviso('');
    setGuardando(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(
        `http://localhost:4000/api/ingresos${editando ? `/${editando}` : ''}`,
        {
          method: editando ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(formulario),
        }
      );
      const respuesta = await res.json();
      if (!res.ok) throw new Error(respuesta.error || 'No se pudo guardar el ingreso.');
      setAviso(editando ? 'Ingreso actualizado.' : 'Ingreso registrado.');
      cancelarEdicion();
      setCargando(true);
      await cargarIngresos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el ingreso.');
    } finally {
      setGuardando(false);
    }
  };

  const editarIngreso = (ingreso: Ingreso) => {
    setEditando(ingreso.id);
    setFormulario({
      monto: String(ingreso.monto),
      fuente: ingreso.fuente,
      tipo: ingreso.tipo,
      periodicidad: ingreso.periodicidad,
      fecha: ingreso.fecha,
    });
    setAviso('');
  };

  const eliminarIngreso = async (id: string) => {
    if (!window.confirm('¿Quieres eliminar este ingreso?')) return;
    setError('');
    setAviso('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`http://localhost:4000/api/ingresos/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const respuesta = await res.json();
      if (!res.ok) throw new Error(respuesta.error || 'No se pudo eliminar el ingreso.');
      setAviso('Ingreso eliminado.');
      if (editando === id) cancelarEdicion();
      setCargando(true);
      await cargarIngresos();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el ingreso.');
    }
  };

  return (
    <section className="ingresos">
      <header className="ingresos-encabezado">
        <div>
          <h3>Gestión de ingresos</h3>
          <p>Registra y consulta tus ingresos.</p>
        </div>
        <span className="ingresos-icono" aria-hidden="true">$</span>
      </header>

      {error && <p className="ingresos-mensaje ingresos-mensaje--error" role="alert">{error}</p>}
      {aviso && <p className="ingresos-mensaje ingresos-mensaje--exito" role="status">{aviso}</p>}

      <form className="ingresos-formulario" onSubmit={guardarIngreso}>
        <h4>{editando ? 'Editar ingreso' : 'Registrar ingreso'}</h4>
        <div className="ingresos-campos">
          <label>
            Monto
            <input
              type="number"
              min="0.01"
              max="9999999999.99"
              step="0.01"
              required
              value={formulario.monto}
              onChange={(event) => setFormulario({ ...formulario, monto: event.target.value })}
              placeholder="0.00"
            />
          </label>
          <label>
            Fuente
            <input
              type="text"
              maxLength={100}
              required
              value={formulario.fuente}
              onChange={(event) => setFormulario({ ...formulario, fuente: event.target.value })}
              placeholder="Ej. Trabajo, ventas"
            />
          </label>
          <label>
            Tipo
            <select
              value={formulario.tipo}
              onChange={(event) => setFormulario({ ...formulario, tipo: event.target.value as TipoIngreso })}
            >
              {Object.entries(etiquetasTipo).map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>{etiqueta}</option>
              ))}
            </select>
          </label>
          <label>
            Periodicidad
            <select
              value={formulario.periodicidad}
              onChange={(event) => setFormulario({ ...formulario, periodicidad: event.target.value as Periodicidad })}
            >
              {Object.entries(etiquetasPeriodicidad).map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>{etiqueta}</option>
              ))}
            </select>
          </label>
          <label>
            Fecha recibida
            <input
              type="date"
              max={hoyLocal()}
              required
              value={formulario.fecha}
              onChange={(event) => setFormulario({ ...formulario, fecha: event.target.value })}
            />
          </label>
        </div>
        <div className="ingresos-acciones-formulario">
          <button type="submit" className="ingresos-boton ingresos-boton--primario" disabled={guardando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Registrar ingreso'}
          </button>
          {editando && (
            <button type="button" className="ingresos-boton" onClick={cancelarEdicion}>
              Cancelar
            </button>
          )}
        </div>
      </form>

      <section className="ingresos-consulta" aria-label="Consulta de ingresos por periodo">
        <div className="ingresos-periodos" role="group" aria-label="Periodos frecuentes">
          <span>Consultar:</span>
          <button type="button" className="ingresos-boton" onClick={() => seleccionarPeriodo('semana')}>Esta semana</button>
          <button type="button" className="ingresos-boton" onClick={() => seleccionarPeriodo('mes')}>Este mes</button>
          <button type="button" className="ingresos-boton" onClick={() => seleccionarPeriodo('anio')}>Este año</button>
        </div>
        <div className="ingresos-filtros">
          <h4>Ingresos por periodo</h4>
          <label>
            Desde
            <input
              type="date"
              value={desde}
              max={hasta}
              onChange={(event) => {
                setError('');
                setCargando(true);
                setDesde(event.target.value);
              }}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={hasta}
              min={desde}
              max={hoyLocal()}
              onChange={(event) => {
                setError('');
                setCargando(true);
                setHasta(event.target.value);
              }}
            />
          </label>
        </div>

        <div className="ingresos-resumen">
          <div><span>Total del periodo</span><strong>{formatoMoneda(datos?.total ?? 0)}</strong></div>
          <div><span>Registros</span><strong>{datos?.cantidad ?? 0}</strong></div>
          {datos && <span className="ingresos-alcance">Mis ingresos</span>}
        </div>

        {cargando ? (
          <p className="ingresos-vacio">Cargando ingresos…</p>
        ) : datos?.ingresos.length ? (
          <div className="ingresos-tabla-contenedor">
            <table className="ingresos-tabla">
              <thead>
                <tr><th>Fecha</th><th>Fuente</th><th>Tipo</th><th>Periodicidad</th><th>Monto</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {datos.ingresos.map((ingreso) => (
                  <tr key={ingreso.id}>
                    <td>{ingreso.fecha}</td>
                    <td>
                      <strong>{ingreso.fuente}</strong>
                    </td>
                    <td><span className="ingresos-etiqueta">{etiquetasTipo[ingreso.tipo]}</span></td>
                    <td>{etiquetasPeriodicidad[ingreso.periodicidad]}</td>
                    <td className="ingresos-monto">{formatoMoneda(ingreso.monto)}</td>
                    <td>
                      {ingreso.es_mio && (
                        <div className="ingresos-acciones">
                          <button type="button" onClick={() => editarIngreso(ingreso)}>Editar</button>
                          <button type="button" className="ingresos-eliminar" onClick={() => void eliminarIngreso(ingreso.id)}>Eliminar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ingresos-vacio">No hay ingresos registrados en este periodo.</p>
        )}
      </section>
    </section>
  );
};
