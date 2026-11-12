import { useCallback, useEffect, useState, type FC, type FormEvent } from 'react';
import { pedir } from './api';
import { Avisos, Barra, Encabezado, useAvisos } from './Comunes';
import { fechaVisible, finMes, inicioMes, moneda } from './formato';

// Presupuesto familiar (RF019 a RF022)

type Estado = 'ok' | 'cerca' | 'excedido';
interface CategoriaPresupuesto { categoria_id: number; categoria: string; monto: number; gastado: number; disponible: number; estado: Estado }
interface PresupuestoFila {
  id: number;
  nombre: string;
  monto_total: number;
  desde: string;
  hasta: string;
  gastado: number;
  disponible: number;
  estado: Estado;
  categorias: CategoriaPresupuesto[];
}
interface Opcion { id: number | string; nombre: string }
interface FilaCategoria { categoria_id: string; monto: string }

const vacio = () => ({ nombre: '', monto_total: '', desde: inicioMes(), hasta: finMes() });

const textoEstado: Record<Estado, string> = {
  ok: 'Dentro del límite',
  cerca: 'Cerca del límite',
  excedido: 'Límite superado',
};

export const Presupuesto: FC<{ permisos: string[] }> = ({ permisos }) => {
  const { errores, aviso, limpiar, fallar, exito } = useAvisos();
  const [presupuestos, setPresupuestos] = useState<PresupuestoFila[]>([]);
  const [categorias, setCategorias] = useState<Opcion[]>([]);
  const [formulario, setFormulario] = useState(vacio);
  const [filas, setFilas] = useState<FilaCategoria[]>([]);
  const [editando, setEditando] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const puedeGestionar = permisos.includes('presupuesto.gestionar');

  const cargar = useCallback(async () => {
    try {
      const r = await pedir('/api/presupuestos');
      setPresupuestos(r.presupuestos);
    } catch (err) {
      fallar(err);
    } finally {
      setCargando(false);
    }
  }, [fallar]);

  useEffect(() => {
    void Promise.resolve().then(cargar);
    pedir('/api/gastos/catalogos').then((r) => setCategorias(r.categorias)).catch(fallar);
  }, [cargar, fallar]);

  const cancelar = () => {
    setEditando(null);
    setFormulario(vacio());
    setFilas([]);
  };

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    limpiar();
    try {
      await pedir(`/api/presupuestos${editando ? `/${editando}` : ''}`, {
        metodo: editando ? 'PUT' : 'POST',
        cuerpo: { ...formulario, categorias: filas },
      });
      exito(editando ? 'Presupuesto actualizado.' : 'Presupuesto creado.');
      cancelar();
      await cargar();
    } catch (err) {
      fallar(err);
    }
  };

  const editar = (p: PresupuestoFila) => {
    limpiar();
    setEditando(p.id);
    setFormulario({ nombre: p.nombre, monto_total: String(p.monto_total), desde: p.desde, hasta: p.hasta });
    setFilas(p.categorias.map((c) => ({ categoria_id: String(c.categoria_id), monto: String(c.monto) })));
  };

  const eliminar = async (id: number) => {
    if (!window.confirm('¿Quieres eliminar este presupuesto?')) return;
    limpiar();
    try {
      await pedir(`/api/presupuestos/${id}`, { metodo: 'DELETE' });
      exito('Presupuesto eliminado.');
      if (editando === id) cancelar();
      await cargar();
    } catch (err) {
      fallar(err);
    }
  };

  const cambiarFila = (indice: number, cambio: Partial<FilaCategoria>) =>
    setFilas(filas.map((f, i) => (i === indice ? { ...f, ...cambio } : f)));

  return (
    <section className="modulo">
      <Encabezado titulo="Presupuesto familiar" descripcion="Define límites de gasto y revisa cuánto queda disponible." icono="◔" />
      <Avisos errores={errores} aviso={aviso} />

      {puedeGestionar && (
        <form className="modulo-formulario" onSubmit={guardar} noValidate>
          <h4>{editando ? 'Editar presupuesto' : 'Crear presupuesto'}</h4>
          <div className="modulo-campos">
            <label>
              Nombre
              <input type="text" maxLength={100} placeholder="Ej. Gastos de noviembre" value={formulario.nombre}
                onChange={(e) => setFormulario({ ...formulario, nombre: e.target.value })} />
            </label>
            <label>
              Monto total
              <input type="number" min="0.01" step="0.01" placeholder="0.00" value={formulario.monto_total}
                onChange={(e) => setFormulario({ ...formulario, monto_total: e.target.value })} />
            </label>
            <label>
              Desde
              <input type="date" value={formulario.desde} onChange={(e) => setFormulario({ ...formulario, desde: e.target.value })} />
            </label>
            <label>
              Hasta
              <input type="date" value={formulario.hasta} onChange={(e) => setFormulario({ ...formulario, hasta: e.target.value })} />
            </label>
          </div>

          {filas.map((fila, i) => (
            <div className="modulo-fila" key={i}>
              <label>
                Categoría
                <select value={fila.categoria_id} onChange={(e) => cambiarFila(i, { categoria_id: e.target.value })}>
                  <option value="">Selecciona…</option>
                  {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </label>
              <label>
                Monto asignado
                <input type="number" min="0.01" step="0.01" value={fila.monto} onChange={(e) => cambiarFila(i, { monto: e.target.value })} />
              </label>
              <button type="button" className="modulo-boton" onClick={() => setFilas(filas.filter((_, j) => j !== i))}>Quitar</button>
            </div>
          ))}

          <div className="modulo-acciones-formulario">
            <button type="button" className="modulo-boton" onClick={() => setFilas([...filas, { categoria_id: '', monto: '' }])}>Asignar a categoría</button>
            <button type="submit" className="modulo-boton modulo-boton--primario">{editando ? 'Guardar cambios' : 'Crear presupuesto'}</button>
            {editando && <button type="button" className="modulo-boton" onClick={cancelar}>Cancelar</button>}
          </div>
        </form>
      )}

      {cargando ? (
        <p className="modulo-vacio">Cargando presupuestos…</p>
      ) : presupuestos.length === 0 ? (
        <p className="modulo-vacio">Todavía no hay presupuestos.</p>
      ) : (
        presupuestos.map((p) => (
          <article className="modulo-consulta" key={p.id}>
            <div className="modulo-tarjeta-titulo">
              <div>
                <h4>{p.nombre}</h4>
                <p className="modulo-nota">{fechaVisible(p.desde)} al {fechaVisible(p.hasta)}</p>
              </div>
              <span className={`modulo-estado modulo-estado--${p.estado}`}>{textoEstado[p.estado]}</span>
            </div>
            {p.estado !== 'ok' && (
              <p className="modulo-mensaje modulo-mensaje--alerta" role="alert">
                {p.estado === 'excedido' ? 'Este presupuesto ya superó su límite.' : 'Este presupuesto está cerca de su límite.'}
              </p>
            )}
            <div className="modulo-resumen">
              <div><span>Presupuesto</span><strong>{moneda(p.monto_total)}</strong></div>
              <div><span>Utilizado</span><strong>{moneda(p.gastado)}</strong></div>
              <div><span>Disponible</span><strong>{moneda(p.disponible)}</strong></div>
            </div>
            <Barra etiqueta="Uso total" detalle={`${moneda(p.gastado)} de ${moneda(p.monto_total)}`} valor={p.gastado} maximo={p.monto_total} estado={p.estado} />
            {p.categorias.map((c) => (
              <Barra key={c.categoria_id} etiqueta={c.categoria} detalle={`${moneda(c.gastado)} de ${moneda(c.monto)}`} valor={c.gastado} maximo={c.monto} estado={c.estado} />
            ))}
            {puedeGestionar && (
              <div className="modulo-acciones">
                <button type="button" onClick={() => editar(p)}>Editar</button>
                <button type="button" className="modulo-eliminar" onClick={() => void eliminar(p.id)}>Eliminar</button>
              </div>
            )}
          </article>
        ))
      )}
    </section>
  );
};
