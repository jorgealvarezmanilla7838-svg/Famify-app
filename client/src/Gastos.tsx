import { useCallback, useEffect, useState, type FC, type FormEvent } from 'react';
import { pedir } from './api';
import { Avisos, Barra, Encabezado, SelectorPeriodo, useAvisos, usePeriodo } from './Comunes';
import { fechaVisible, hoy, moneda } from './formato';

// Gestión de gastos y egresos (RF013 a RF018)

interface Opcion { id: number | string; nombre: string }
interface Gasto {
  id: number | string;
  fecha: string;
  monto: string;
  descripcion: string | null;
  categoria_id: number | string;
  categoria: string;
  metodo_pago_id: number | string;
  metodo_pago: string;
  integrante: string;
  es_mio: boolean;
}
interface PorCategoria { categoria_id: number | string; categoria: string; total: string; porcentaje: string }

const POR_PAGINA = 50;

const formularioVacio = () => ({ monto: '', categoria_id: '', metodo_pago_id: '', fecha: hoy(), descripcion: '' });

export const Gastos: FC<{ esAdmin: boolean; permisos: string[] }> = ({ esAdmin, permisos }) => {
  const periodo = usePeriodo();
  const { desde, hasta } = periodo;
  const { errores, aviso, limpiar, fallar, exito } = useAvisos();
  const [categorias, setCategorias] = useState<Opcion[]>([]);
  const [metodos, setMetodos] = useState<Opcion[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [total, setTotal] = useState('0');
  const [porCategoria, setPorCategoria] = useState<PorCategoria[]>([]);
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [formulario, setFormulario] = useState(formularioVacio);
  const [editando, setEditando] = useState<number | string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cantidad, setCantidad] = useState(0);
  // Al cambiar periodo o categoría la lista vuelve a la primera página
  const filtrosActuales = `${desde}|${hasta}|${filtroCategoria}`;
  const [paginacion, setPaginacion] = useState({ filtros: filtrosActuales, pagina: 1 });
  const pagina = paginacion.filtros === filtrosActuales ? paginacion.pagina : 1;
  const totalPaginas = Math.max(1, Math.ceil(cantidad / POR_PAGINA));

  const puedeRegistrar = permisos.includes('gastos.registrar');
  const puedeEditar = permisos.includes('gastos.editar');
  const puedeVerReportes = permisos.includes('reportes.ver');

  useEffect(() => {
    pedir('/api/gastos/catalogos')
      .then((r) => {
        setCategorias(r.categorias);
        setMetodos(r.metodos_pago);
      })
      .catch(fallar);
  }, [fallar]);

  const cargar = useCallback(async () => {
    try {
      const consulta = `desde=${desde}&hasta=${hasta}`;
      const categoria = filtroCategoria ? `&categoria_id=${filtroCategoria}` : '';
      const [lista, categoriasPeriodo] = await Promise.all([
        pedir(`/api/gastos?${consulta}${categoria}&limite=${POR_PAGINA}&pagina=${pagina}`),
        // El desglose es complementario: si el permiso se retiró, la lista de gastos debe seguir visible
        puedeVerReportes
          ? pedir(`/api/gastos/por-categoria?${consulta}`).catch(() => ({ categorias: [] }))
          : Promise.resolve({ categorias: [] }),
      ]);
      setGastos(lista.gastos);
      setTotal(lista.total);
      setCantidad(lista.cantidad);
      setPorCategoria(categoriasPeriodo.categorias);
    } catch (err) {
      fallar(err);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, filtroCategoria, pagina, puedeVerReportes, fallar]);

  useEffect(() => {
    void Promise.resolve().then(cargar);
  }, [cargar]);

  const cancelar = () => {
    setEditando(null);
    setFormulario(formularioVacio());
  };

  const guardar = async (evento: FormEvent) => {
    evento.preventDefault();
    limpiar();
    try {
      await pedir(`/api/gastos${editando ? `/${editando}` : ''}`, {
        metodo: editando ? 'PUT' : 'POST',
        cuerpo: formulario,
      });
      exito(editando ? 'Gasto actualizado.' : 'Gasto registrado.');
      cancelar();
      await cargar();
    } catch (err) {
      fallar(err);
    }
  };

  const editar = (gasto: Gasto) => {
    limpiar();
    setEditando(gasto.id);
    setFormulario({
      monto: String(gasto.monto),
      categoria_id: String(gasto.categoria_id),
      metodo_pago_id: String(gasto.metodo_pago_id),
      fecha: gasto.fecha,
      descripcion: gasto.descripcion ?? '',
    });
  };

  const eliminar = async (id: number | string) => {
    if (!window.confirm('¿Quieres eliminar este gasto?')) return;
    limpiar();
    try {
      await pedir(`/api/gastos/${id}`, { metodo: 'DELETE' });
      exito('Gasto eliminado.');
      if (editando === id) cancelar();
      await cargar();
    } catch (err) {
      fallar(err);
    }
  };

  const mayor = Math.max(0, ...porCategoria.map((c) => Number(c.total)));

  return (
    <section className="modulo">
      <Encabezado titulo="Gestión de gastos" descripcion="Registra y consulta en qué se usa el dinero." icono="−" />
      <Avisos errores={errores} aviso={aviso} />

      {(puedeRegistrar || editando) && (
        <form className="modulo-formulario" onSubmit={guardar} noValidate>
          <h4>{editando ? 'Editar gasto' : 'Registrar gasto'}</h4>
          <div className="modulo-campos">
            <label>
              Monto
              <input type="number" min="0.01" step="0.01" placeholder="0.00" value={formulario.monto}
                onChange={(e) => setFormulario({ ...formulario, monto: e.target.value })} />
            </label>
            <label>
              Categoría
              <select value={formulario.categoria_id} onChange={(e) => setFormulario({ ...formulario, categoria_id: e.target.value })}>
                <option value="">Selecciona…</option>
                {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label>
              Método de pago
              <select value={formulario.metodo_pago_id} onChange={(e) => setFormulario({ ...formulario, metodo_pago_id: e.target.value })}>
                <option value="">Selecciona…</option>
                {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </label>
            <label>
              Fecha
              <input type="date" max={hoy()} value={formulario.fecha} onChange={(e) => setFormulario({ ...formulario, fecha: e.target.value })} />
            </label>
            <label className="modulo-campo-ancho">
              Descripción (opcional)
              <input type="text" maxLength={200} value={formulario.descripcion} onChange={(e) => setFormulario({ ...formulario, descripcion: e.target.value })} />
            </label>
          </div>
          <div className="modulo-acciones-formulario">
            <button type="submit" className="modulo-boton modulo-boton--primario">{editando ? 'Guardar cambios' : 'Registrar gasto'}</button>
            {editando && <button type="button" className="modulo-boton" onClick={cancelar}>Cancelar</button>}
          </div>
        </form>
      )}

      <section className="modulo-consulta" aria-label="Consulta de gastos por periodo">
        <SelectorPeriodo periodo={periodo} titulo="Gastos por periodo" />
        <div className="modulo-filtros modulo-filtros--simple">
          <label>
            Filtrar por categoría
            <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
              <option value="">Todas</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        </div>
        <div className="modulo-resumen">
          <div><span>Total del periodo</span><strong>{moneda(total)}</strong></div>
          <div><span>Registros</span><strong>{cantidad}</strong></div>
          <span className="modulo-alcance">{esAdmin ? 'Toda la familia' : 'Mis gastos'}</span>
        </div>

        {cargando ? (
          <p className="modulo-vacio">Cargando gastos…</p>
        ) : gastos.length ? (
          <div className="modulo-tabla-contenedor">
            <table className="modulo-tabla">
              <thead>
                <tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Método</th><th>Integrante</th><th>Monto</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {gastos.map((g) => (
                  <tr key={g.id}>
                    <td>{fechaVisible(g.fecha)}</td>
                    <td>{g.descripcion || '—'}</td>
                    <td><span className="modulo-etiqueta">{g.categoria}</span></td>
                    <td>{g.metodo_pago}</td>
                    <td>{g.integrante}</td>
                    <td className="modulo-monto modulo-monto--gasto">{moneda(g.monto)}</td>
                    <td>
                      {puedeEditar && (esAdmin || g.es_mio) && (
                        <div className="modulo-acciones">
                          <button type="button" onClick={() => editar(g)}>Editar</button>
                          <button type="button" className="modulo-eliminar" onClick={() => void eliminar(g.id)}>Eliminar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPaginas > 1 && (
              <div className="modulo-acciones-formulario">
                <button type="button" className="modulo-boton" disabled={pagina <= 1}
                  onClick={() => setPaginacion({ filtros: filtrosActuales, pagina: pagina - 1 })}>Anterior</button>
                <span className="modulo-nota">Página {pagina} de {totalPaginas}</span>
                <button type="button" className="modulo-boton" disabled={pagina >= totalPaginas}
                  onClick={() => setPaginacion({ filtros: filtrosActuales, pagina: pagina + 1 })}>Siguiente</button>
              </div>
            )}
          </div>
        ) : (
          <p className="modulo-vacio">No hay gastos registrados en este periodo.</p>
        )}
      </section>

      {porCategoria.length > 0 && (
        <section className="modulo-consulta" aria-label="Gastos por categoría">
          <h4>Gasto de la familia por categoría</h4>
          {porCategoria.map((c) => (
            <Barra key={c.categoria_id} etiqueta={c.categoria} detalle={`${moneda(c.total)} (${c.porcentaje} %)`}
              valor={Number(c.total)} maximo={mayor} estado="gasto" />
          ))}
        </section>
      )}
    </section>
  );
};
