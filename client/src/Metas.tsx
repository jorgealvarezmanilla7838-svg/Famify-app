import { useCallback, useEffect, useState, type FC, type FormEvent } from 'react';
import { pedir } from './api';
import { Avisos, Barra, Encabezado, useAvisos } from './Comunes';
import { fechaVisible, moneda } from './formato';

// Metas de ahorro (RF023 a RF026)

interface Meta {
  id: number;
  nombre: string;
  descripcion: string | null;
  monto_objetivo: number;
  monto_ahorrado: number;
  faltante: number;
  porcentaje: number;
  fecha_limite: string | null;
  alcance: 'familia' | 'personal';
  integrante: string | null;
  puede_editar: boolean;
}

const vacio = () => ({ nombre: '', descripcion: '', monto_objetivo: '', fecha_limite: '', alcance: 'familia', usuario_id: '' });

export const Metas: FC<{ permisos: string[]; esAdmin: boolean }> = ({ permisos, esAdmin }) => {
  const { errores, aviso, limpiar, fallar, exito } = useAvisos();
  const [metas, setMetas] = useState<Meta[]>([]);
  const [formulario, setFormulario] = useState(vacio);
  const [editando, setEditando] = useState<number | null>(null);
  const [aportes, setAportes] = useState<Record<number, string>>({});
  const [cargando, setCargando] = useState(true);
  const [integrantes, setIntegrantes] = useState<{ id: number; nombre: string }[]>([]);
  const puedeCrear = permisos.includes('metas.gestionar');
  const puedeAportar = permisos.includes('metas.aportar');
  const puedeEditar = permisos.includes('metas.gestionar');

  const cargar = useCallback(async () => {
    try {
      const r = await pedir('/api/metas');
      setMetas(r.metas);
    } catch (err) {
      fallar(err);
    } finally {
      setCargando(false);
    }
  }, [fallar]);

  useEffect(() => {
    void Promise.resolve().then(cargar);
    if (esAdmin) pedir('/api/administracion/integrantes/nombres').then((r) => setIntegrantes(r.integrantes)).catch(fallar);
  }, [cargar, esAdmin, fallar]);

  const cancelar = () => {
    setEditando(null);
    setFormulario(vacio());
  };

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    limpiar();
    try {
      await pedir(`/api/metas${editando ? `/${editando}` : ''}`, {
        metodo: editando ? 'PUT' : 'POST',
        cuerpo: formulario,
      });
      exito(editando ? 'Meta actualizada.' : 'Meta creada.');
      cancelar();
      await cargar();
    } catch (err) {
      fallar(err);
    }
  };

  const editar = (meta: Meta) => {
    limpiar();
    setEditando(meta.id);
    setFormulario({
      nombre: meta.nombre,
      descripcion: meta.descripcion ?? '',
      monto_objetivo: String(meta.monto_objetivo),
      fecha_limite: meta.fecha_limite ?? '',
      alcance: meta.alcance,
      usuario_id: '',
    });
  };

  const aportar = async (evento: FormEvent, id: number) => {
    evento.preventDefault();
    limpiar();
    try {
      await pedir(`/api/metas/${id}/aportaciones`, { metodo: 'POST', cuerpo: { monto: aportes[id] ?? '' } });
      exito('Aportación registrada.');
      setAportes({ ...aportes, [id]: '' });
      await cargar();
    } catch (err) {
      fallar(err);
    }
  };

  return (
    <section className="modulo">
      <Encabezado titulo="Metas de ahorro" descripcion="Ahorra en conjunto o por integrante y revisa el avance." icono="★" />
      <Avisos errores={errores} aviso={aviso} />

      {(puedeCrear || editando) && (
        <form className="modulo-formulario" onSubmit={guardar} noValidate>
          <h4>{editando ? 'Modificar meta' : 'Crear meta'}</h4>
          <div className="modulo-campos">
            <label>
              Nombre
              <input type="text" maxLength={100} placeholder="Ej. Vacaciones" value={formulario.nombre}
                onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })} />
            </label>
            <label>
              Monto objetivo
              <input type="number" min="0.01" step="0.01" placeholder="0.00" value={formulario.monto_objetivo}
                onChange={(e) => setFormulario({ ...formulario, monto_objetivo: e.target.value })} />
            </label>
            <label>
              Fecha límite (opcional)
              <input type="date" value={formulario.fecha_limite} onChange={(e) => setFormulario({ ...formulario, fecha_limite: e.target.value })} />
            </label>
            {!editando && (
              <label>
                Para quién
                <select value={formulario.alcance} onChange={(e) => setFormulario({ ...formulario, alcance: e.target.value })}>
                  <option value="familia">Toda la familia</option>
                  <option value="personal">{esAdmin ? 'Un integrante' : 'Solo para mí'}</option>
                </select>
              </label>
            )}
            {!editando && esAdmin && formulario.alcance === 'personal' && (
              <label>
                Integrante
                <select value={formulario.usuario_id} onChange={(e) => setFormulario({ ...formulario, usuario_id: e.target.value })}>
                  <option value="">Yo</option>
                  {integrantes.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
                </select>
              </label>
            )}
            <label className="modulo-campo-ancho">
              Para qué se utilizará (opcional)
              <input type="text" maxLength={200} value={formulario.descripcion} onChange={(e) => setFormulario({ ...formulario, descripcion: e.target.value })} />
            </label>
          </div>
          <div className="modulo-acciones-formulario">
            <button type="submit" className="modulo-boton modulo-boton--primario">{editando ? 'Guardar cambios' : 'Crear meta'}</button>
            {editando && <button type="button" className="modulo-boton" onClick={cancelar}>Cancelar</button>}
          </div>
        </form>
      )}

      {cargando ? (
        <p className="modulo-vacio">Cargando metas…</p>
      ) : metas.length === 0 ? (
        <p className="modulo-vacio">Todavía no hay metas de ahorro.</p>
      ) : (
        metas.map((meta) => (
          <article className="modulo-consulta" key={meta.id}>
            <div className="modulo-tarjeta-titulo">
              <div>
                <h4>{meta.nombre}</h4>
                {meta.descripcion && <p className="modulo-nota">{meta.descripcion}</p>}
                {meta.fecha_limite && <p className="modulo-nota">Fecha límite: {fechaVisible(meta.fecha_limite)}</p>}
              </div>
              <span className="modulo-etiqueta">{meta.alcance === 'familia' ? 'Familia' : meta.integrante ?? 'Personal'}</span>
            </div>
            <Barra etiqueta={`Avance: ${meta.porcentaje} %`} detalle={`${moneda(meta.monto_ahorrado)} de ${moneda(meta.monto_objetivo)}`}
              valor={meta.monto_ahorrado} maximo={meta.monto_objetivo} estado="ingreso" />
            <p className="modulo-nota">{meta.faltante > 0 ? `Faltan ${moneda(meta.faltante)}` : '¡Meta alcanzada!'}</p>
            <div className="modulo-fila-acciones">
              {puedeAportar && (
                <form className="modulo-aporte" onSubmit={(e) => void aportar(e, meta.id)} noValidate>
                  <label>
                    Aportación
                    <input type="number" min="0.01" step="0.01" placeholder="0.00" value={aportes[meta.id] ?? ''}
                      onChange={(e) => setAportes({ ...aportes, [meta.id]: e.target.value })} />
                  </label>
                  <button type="submit" className="modulo-boton modulo-boton--primario">Aportar</button>
                </form>
              )}
              {puedeEditar && meta.puede_editar && (
                <button type="button" className="modulo-boton" onClick={() => editar(meta)}>Modificar</button>
              )}
            </div>
          </article>
        ))
      )}
    </section>
  );
};
