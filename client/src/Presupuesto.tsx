import { useCallback, useEffect, useState, type FormEvent } from 'react';
import './Presupuesto.css';

// MÓDULO 5: Presupuesto familiar (RF19 a RF22)
// RF21 va arriba (resumen), RF19 en medio (presupuesto general) y RF20 abajo (por categoría)
// El RF22 (alertas por correo) lo hace el servidor: server/src/modulos/presupuesto/presupuesto.alertas.ts

interface Miembro {
  id: number;
  nombre: string;
  ingreso_base: number;
  ingreso_registrado: number;
  ingreso_mensual: number;
}

interface CategoriaPpto {
  id: number;
  nombre: string;
  fijos: number;
  promedio: number;
  recomendado: number;
  asignado: number;
  gastado: number;
}

interface PresupuestoActual {
  id: number;
  monto_total: number;
  umbral_alerta: number;
  gastado: number;
  disponible: number;
  porcentaje_usado: number;
  asignado_total: number;
  sin_asignar: number;
}

interface RespuestaPresupuesto {
  mes: string;
  periodo: string;
  es_admin: boolean;
  ingreso_total: number;
  gastos_fijos_total: number;
  miembros: Miembro[];
  presupuesto: PresupuestoActual | null;
  categorias: CategoriaPpto[];
}

const formatoMoneda = (monto: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(monto);

const mesActual = () => {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
};

// verde normal, naranja cuando llega al porcentaje de alerta y rojo cuando se pasa
const colorEstado = (porcentaje: number, umbral: number) => {
  if (porcentaje >= 100) return '#dc2626';
  if (porcentaje >= umbral) return '#f59e0b';
  return '#16a34a';
};

const URL_API = 'http://localhost:4000/api/presupuesto';

export const Presupuesto = ({ token }: { token: string }) => {
  const [mes, setMes] = useState(mesActual);
  const [datos, setDatos] = useState<RespuestaPresupuesto | null>(null);
  const [montoTotal, setMontoTotal] = useState('');
  const [umbral, setUmbral] = useState('80');
  const [asignaciones, setAsignaciones] = useState<Record<number, string>>({});
  const [cargando, setCargando] = useState(true);
  const [guardandoGeneral, setGuardandoGeneral] = useState(false);
  const [guardandoCategorias, setGuardandoCategorias] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(
    async (mesConsulta: string) => {
      try {
        const res = await fetch(`${URL_API}?mes=${encodeURIComponent(mesConsulta)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const respuesta = await res.json();
        if (!res.ok) throw new Error(respuesta.error || 'No se pudo consultar el presupuesto.');

        const r = respuesta as RespuestaPresupuesto;
        setDatos(r);
        // si no hay presupuesto, se sugiere la suma de ingresos de la familia
        setMontoTotal(r.presupuesto ? String(r.presupuesto.monto_total) : r.ingreso_total > 0 ? String(r.ingreso_total) : '');
        setUmbral(String(r.presupuesto?.umbral_alerta ?? 80));
        setAsignaciones(
          Object.fromEntries(r.categorias.map((c) => [c.id, c.asignado > 0 ? String(c.asignado) : '']))
        );
        setError('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo consultar el presupuesto.');
      } finally {
        setCargando(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void Promise.resolve().then(() => cargar(mes));
  }, [cargar, mes]);

  const cambiarMes = (nuevoMes: string) => {
    if (!nuevoMes) return;
    setCargando(true);
    setAviso('');
    setMes(nuevoMes);
  };

  // RF19_ Guardar el presupuesto general del mes
  const enviarPresupuesto = async (monto: string) => {
    setGuardandoGeneral(true);
    setError('');
    setAviso('');
    try {
      const res = await fetch(URL_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mes, monto_total: monto, umbral_alerta: umbral }),
      });
      const respuesta = await res.json();
      if (!res.ok) throw new Error(respuesta.error || 'No se pudo guardar el presupuesto.');
      setAviso(respuesta.message);
      await cargar(mes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el presupuesto.');
    } finally {
      setGuardandoGeneral(false);
    }
  };

  const guardarPresupuesto = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void enviarPresupuesto(montoTotal);
  };

  // RF19_ Poner como presupuesto la suma actual de ingresos de la familia
  const usarIngresosComoPresupuesto = () => {
    if (datos) void enviarPresupuesto(String(datos.ingreso_total));
  };

  // RF20_ Poner en cada categoría el monto recomendado
  const usarRecomendado = () => {
    if (!datos) return;
    setAsignaciones(
      Object.fromEntries(datos.categorias.map((c) => [c.id, c.recomendado > 0 ? String(c.recomendado) : '']))
    );
  };

  // RF20_ Guardar el presupuesto por categoría
  const guardarCategorias = async () => {
    if (!datos?.presupuesto) return;
    setGuardandoCategorias(true);
    setError('');
    setAviso('');
    try {
      const res = await fetch(`${URL_API}/${datos.presupuesto.id}/categorias`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          categorias: datos.categorias.map((c) => ({ categoria_id: c.id, monto_asignado: asignaciones[c.id] ?? '' })),
        }),
      });
      const respuesta = await res.json();
      if (!res.ok) throw new Error(respuesta.error || 'No se pudo guardar el presupuesto por categoría.');
      setAviso(respuesta.message);
      await cargar(mes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el presupuesto por categoría.');
    } finally {
      setGuardandoCategorias(false);
    }
  };

  if (cargando && !datos) return <p className="ppto-cargando">Cargando presupuesto...</p>;

  const ppto = datos?.presupuesto ?? null;
  const esAdmin = Boolean(datos?.es_admin);
  const sumaAsignada = (datos?.categorias ?? []).reduce((total, c) => total + (Number(asignaciones[c.id]) || 0), 0);
  const sumaRecomendada = (datos?.categorias ?? []).reduce((total, c) => total + c.recomendado, 0);
  const restante = ppto ? Math.round((ppto.monto_total - sumaAsignada) * 100) / 100 : 0;
  const color = ppto ? colorEstado(ppto.porcentaje_usado, ppto.umbral_alerta) : '#16a34a';
  const difiereDeIngresos = Boolean(ppto && datos && Math.abs(ppto.monto_total - datos.ingreso_total) > 0.009);
  const sobraGastosFijos = datos ? datos.ingreso_total - datos.gastos_fijos_total : 0;

  return (
    <div className="ppto">
      <div className="ppto-encabezado">
        <div>
          <h2>💰 Presupuesto familiar</h2>
          <p>Controla cuánto puede gastar la familia en el mes.</p>
        </div>
        <label className="ppto-mes">
          Mes
          <input type="month" value={mes} onChange={(e) => cambiarMes(e.target.value)} />
        </label>
      </div>

      {error && <div className="ppto-mensaje ppto-mensaje--error">{error}</div>}
      {aviso && <div className="ppto-mensaje ppto-mensaje--ok">{aviso}</div>}

      {datos && (
        <>
          {/* RF21_ Consulta del presupuesto disponible: arriba para verlo apenas se entra */}
          <section className="ppto-tarjeta">
            <h3>📊 Presupuesto disponible de {datos.periodo}</h3>
            {!ppto ? (
              <p className="ppto-nota">
                Todavía no hay presupuesto para este mes.
                {esAdmin ? ' Créalo en la sección de abajo.' : ' El administrador debe crearlo.'}
              </p>
            ) : (
              <>
                {ppto.porcentaje_usado >= 100 && (
                  <div className="ppto-alerta ppto-alerta--roja">🚨 Superaron el presupuesto del mes.</div>
                )}
                {ppto.porcentaje_usado >= ppto.umbral_alerta && ppto.porcentaje_usado < 100 && (
                  <div className="ppto-alerta ppto-alerta--naranja">
                    ⚠️ Ya se usó el {ppto.porcentaje_usado}% del presupuesto, está por agotarse.
                  </div>
                )}

                {difiereDeIngresos && datos && (
                  <div className="ppto-alerta ppto-alerta--naranja">
                    Los ingresos de la familia este mes suman {formatoMoneda(datos.ingreso_total)}, pero el presupuesto
                    guardado es de {formatoMoneda(ppto.monto_total)}.{' '}
                    {esAdmin ? (
                      <button type="button" onClick={usarIngresosComoPresupuesto} disabled={guardandoGeneral}>
                        Usar {formatoMoneda(datos.ingreso_total)} como presupuesto
                      </button>
                    ) : (
                      'El administrador puede actualizarlo.'
                    )}
                  </div>
                )}

                <div className="ppto-resumen">
                  <div
                    className="ppto-dona"
                    style={{ background: `conic-gradient(${color} ${Math.min(100, ppto.porcentaje_usado)}%, #e2e8f0 0)` }}
                  >
                    <div className="ppto-dona-centro">
                      <strong>{ppto.porcentaje_usado}%</strong>
                      <span>usado</span>
                    </div>
                  </div>

                  <div className="ppto-datos">
                    <div className="ppto-dato">
                      <span>Presupuesto</span>
                      <strong>{formatoMoneda(ppto.monto_total)}</strong>
                    </div>
                    <div className="ppto-dato">
                      <span>Gastado</span>
                      <strong style={{ color }}>{formatoMoneda(ppto.gastado)}</strong>
                    </div>
                    <div className="ppto-dato">
                      <span>{ppto.disponible < 0 ? 'Excedido' : 'Disponible'}</span>
                      <strong style={{ color: ppto.disponible < 0 ? '#dc2626' : '#16a34a' }}>
                        {formatoMoneda(Math.abs(ppto.disponible))}
                      </strong>
                    </div>
                    <div className="ppto-dato">
                      <span>Sin asignar a categorías</span>
                      <strong>{formatoMoneda(ppto.sin_asignar)}</strong>
                    </div>
                  </div>
                </div>
                <p className="ppto-nota">
                  💡 Lo que está “sin asignar” no tiene categoría definida, así que puede usarse para otros gastos o
                  para ahorro.
                </p>
              </>
            )}
          </section>

          {/* RF19_ Creación de presupuesto */}
          <section className="ppto-tarjeta">
            <h3>🧾 Presupuesto general</h3>
            <div className="ppto-total-ingresos">
              <span>Suma de los ingresos mensuales de la familia</span>
              <strong>{formatoMoneda(datos.ingreso_total)}</strong>
            </div>

            {datos.miembros.length > 0 && (
              <ul className="ppto-miembros">
                {datos.miembros.map((m) => (
                  <li key={m.id}>
                    <span>
                      {m.nombre}
                      <small>
                        {' '}
                        (base {formatoMoneda(m.ingreso_base)} + registrado este mes {formatoMoneda(m.ingreso_registrado)})
                      </small>
                    </span>
                    <span>{formatoMoneda(m.ingreso_mensual)}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="ppto-nota">
              Incluye el ingreso principal del cuestionario de cada integrante más los ingresos que registró este mes.
            </p>

            <p className="ppto-leyenda">
              Es necesario cubrir los gastos obligados (gastos fijos) de la familia, que suman{' '}
              <strong>{formatoMoneda(datos.gastos_fijos_total)}</strong> al mes.
              {datos.ingreso_total > 0 &&
                (sobraGastosFijos >= 0 ? (
                  <> Con los ingresos actuales les quedarían {formatoMoneda(sobraGastosFijos)} para otros gastos y ahorro.</>
                ) : (
                  <> Los ingresos actuales no alcanzan, faltarían {formatoMoneda(Math.abs(sobraGastosFijos))}.</>
                ))}
            </p>

            {esAdmin ? (
              <form className="ppto-formulario" onSubmit={guardarPresupuesto}>
                <label>
                  Presupuesto total del mes
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={montoTotal}
                    onChange={(e) => setMontoTotal(e.target.value)}
                    placeholder="Ej. 15000"
                    required
                  />
                </label>
                <label>
                  Avisar al llegar a (%)
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={umbral}
                    onChange={(e) => setUmbral(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" disabled={guardandoGeneral}>
                  {guardandoGeneral ? 'Guardando...' : ppto ? 'Actualizar presupuesto' : 'Crear presupuesto'}
                </button>
              </form>
            ) : (
              <p className="ppto-nota">Solo el administrador puede crear o cambiar el presupuesto.</p>
            )}
          </section>

          {/* RF20_ Asignación de presupuesto por categoría */}
          <section className="ppto-tarjeta">
            <h3>🗂️ Presupuesto por categoría</h3>
            {!ppto ? (
              <p className="ppto-nota">Primero crea el presupuesto general para poder repartirlo por categoría.</p>
            ) : (
              <>
                <p className="ppto-leyenda">
                  Recomendación: para cubrir lo de todos los integrantes se necesitan{' '}
                  <strong>{formatoMoneda(sumaRecomendada)}</strong> al mes entre todas las categorías (según los gastos
                  fijos y el promedio de los últimos 3 meses).
                </p>

                <div className="ppto-categorias">
                  {datos.categorias.map((c) => {
                    const asignado = Number(asignaciones[c.id]) || 0;
                    const porcentaje = asignado > 0 ? (c.gastado / asignado) * 100 : c.gastado > 0 ? 100 : 0;
                    const colorCat = asignado > 0 ? colorEstado(porcentaje, ppto.umbral_alerta) : '#94a3b8';
                    return (
                      <div className="ppto-categoria" key={c.id}>
                        <div className="ppto-categoria-fila">
                          <strong>{c.nombre}</strong>
                          {esAdmin ? (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={asignaciones[c.id] ?? ''}
                              onChange={(e) => setAsignaciones({ ...asignaciones, [c.id]: e.target.value })}
                              placeholder="0.00"
                            />
                          ) : (
                            <span>{formatoMoneda(c.asignado)}</span>
                          )}
                        </div>
                        <div className="ppto-barra">
                          <div style={{ width: `${Math.min(100, porcentaje)}%`, background: colorCat }} />
                        </div>
                        <small>
                          Gastado {formatoMoneda(c.gastado)}
                          {asignado > 0 ? ` de ${formatoMoneda(asignado)}` : ' (sin presupuesto asignado)'}
                          {' · '}Recomendado {c.recomendado > 0 ? formatoMoneda(c.recomendado) : 'sin datos aún'}
                          {c.fijos > 0 && ` (gastos fijos ${formatoMoneda(c.fijos)})`}
                        </small>
                      </div>
                    );
                  })}
                </div>

                <p className={restante < 0 ? 'ppto-restante ppto-restante--mal' : 'ppto-restante'}>
                  {restante < 0
                    ? `Te pasas del presupuesto por ${formatoMoneda(Math.abs(restante))}.`
                    : `Falta repartir ${formatoMoneda(restante)} del presupuesto.`}
                </p>

                {esAdmin && (
                  <div className="ppto-botones">
                    <button type="button" className="ppto-secundario" onClick={usarRecomendado}>
                      Usar recomendado
                    </button>
                    <button type="button" onClick={guardarCategorias} disabled={guardandoCategorias || restante < 0}>
                      {guardandoCategorias ? 'Guardando...' : 'Guardar por categoría'}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
};
