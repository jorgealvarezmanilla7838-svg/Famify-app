import React, { useState, useEffect } from 'react';

interface Categoria {
  id: number;
  nombre: string;
}

interface MetodoPago {
  id: string; // Adaptado a texto para coincidir con la columna metodo_de_pago
  nombre: string;
  es_credito: boolean;
}

interface Gasto {
  id: number;
  fecha: string;
  monto: number;
  descripcion: string | null;
  categoria_id: number;
  categoria: string;
  metodo_pago_id: string | null;
  metodo_pago: string | null;
  usuario_id: number;
  integrante: string;
  es_mio: boolean;
}

interface GastoPorCategoria {
  categoria_id: number;
  categoria: string;
  total: string;
  porcentaje: string;
}

const Gastos: React.FC<{ token: string }> = ({ token }) => {
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [metodosPago, setMetodosPago] = useState<MetodoPago[]>([]);
  const [resumenCategorias, setResumenCategorias] = useState<GastoPorCategoria[]>([]);
  
  const hoy = new Date().toISOString().split('T')[0];
  const primerDiaMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const [desde, setDesde] = useState(primerDiaMes);
  const [hasta, setHasta] = useState(hoy);
  
  const [monto, setMonto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [metodoPagoId, setMetodoPagoId] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [editandoId, setEditandoId] = useState<number | null>(null);

  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const res = await fetch('http://localhost:4000/api/gastos/catalogos', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
          setCategorias(data.categorias);
          setMetodosPago(data.metodos_pago);
        }
      } catch (err) {
        console.error('Error al cargar catálogos', err);
      }
    };
    cargarCatalogos();
  }, [token]);

  const cargarGastos = async () => {
    setCargando(true);
    setError('');
    try {
      // 1. Obtener la lista de gastos
      const resGastos = await fetch(`http://localhost:4000/api/gastos?desde=${desde}&hasta=${hasta}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const dataGastos = await resGastos.json();

      if (dataGastos.success) {
        setGastos(dataGastos.gastos);
      } else {
        setError(dataGastos.error || 'Error al obtener gastos');
      }

      // 2. Obtener resumen por categoría de forma opcional (si no tiene permisos no rompe la vista)
      try {
        const resCat = await fetch(`http://localhost:4000/api/gastos/por-categoria?desde=${desde}&hasta=${hasta}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const dataCat = await resCat.json();
        if (dataCat.success) {
          setResumenCategorias(dataCat.categorias || []);
        }
      } catch {
        console.warn('No se pudo cargar el resumen por categorías.');
      }

    } catch (err) {
      setError('Error de conexión con el servidor.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarGastos();
  }, [desde, hasta]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!monto || !categoriaId || !metodoPagoId) {
      setError('El monto, la categoría y el método de pago son obligatorios.');
      return;
    }

    const payload = {
      monto: Number(monto),
      descripcion,
      categoria_id: Number(categoriaId),
      metodo_pago_id: metodoPagoId, // Se envía la cadena directamente (ej. "tarjeta_credito")
      fecha
    };

    try {
      const url = editandoId
        ? `http://localhost:4000/api/gastos/${editandoId}`
        : 'http://localhost:4000/api/gastos';
      const method = editandoId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        limpiarFormulario();
        cargarGastos();
      } else {
        setError(data.error || 'Error al guardar el gasto.');
      }
    } catch (err) {
      setError('Error al procesar la solicitud.');
    }
  };

  const iniciarEdicion = (g: Gasto) => {
    setEditandoId(g.id);
    setMonto(String(g.monto));
    setDescripcion(g.descripcion || '');
    setCategoriaId(String(g.categoria_id));
    setMetodoPagoId(g.metodo_pago_id ? String(g.metodo_pago_id) : '');
    setFecha(g.fecha);
  };

  const eliminarGasto = async (id: number) => {
    if (!confirm('¿Estás seguro de eliminar este gasto?')) return;
    try {
      const res = await fetch(`http://localhost:4000/api/gastos/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        cargarGastos();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Error al eliminar el gasto.');
    }
  };

  const limpiarFormulario = () => {
    setEditandoId(null);
    setMonto('');
    setDescripcion('');
    setCategoriaId('');
    setMetodoPagoId('');
    setFecha(hoy);
    setError('');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      <h2>Gestión de Gastos y Egresos</h2>

      {error && <div style={{ color: 'red', marginBottom: '10px' }}>{error}</div>}

      <form onSubmit={handleSubmit} style={{ background: '#c8c6c6', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
        <h3>{editandoId ? 'Editar Gasto' : 'Registrar Nuevo Gasto'}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <label>Monto ($):</label>
            <input type="number" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div>
            <label>Fecha:</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div>
            <label>Categoría (RF015):</label>
            <select value={categoriaId} onChange={e => setCategoriaId(e.target.value)} required style={{ width: '100%' }}>
              <option value="">Selecciona categoría...</option>
              {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label>Método de Pago (RF016):</label>
            <select value={metodoPagoId} onChange={e => setMetodoPagoId(e.target.value)} required style={{ width: '100%' }}>
              <option value="">Selecciona método...</option>
              {metodosPago.map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: '10px' }}>
          <label>Descripción / Notas:</label>
          <input type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ marginTop: '15px' }}>
          <button type="submit">{editandoId ? 'Actualizar Gasto' : 'Guardar Gasto'}</button>
          {editandoId && <button type="button" onClick={limpiarFormulario} style={{ marginLeft: '10px' }}>Cancelar</button>}
        </div>
      </form>

      <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '20px' }}>
        <strong>Filtrar Periodo:</strong>
        <label>Desde: <input type="date" value={desde} onChange={e => setDesde(e.target.value)} /></label>
        <label>Hasta: <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} /></label>
      </div>

      {resumenCategorias.length > 0 && (
        <div style={{ marginBottom: '20px', background: '#d1ffff', padding: '15px', borderRadius: '8px' }}>
          <h4>Gastos por Categoría (RF018)</h4>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            {resumenCategorias.map(rc => (
              <div key={rc.categoria_id} style={{ background: '#fff', padding: '10px', borderRadius: '5px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <strong>{rc.categoria}:</strong> ${Number(rc.total).toFixed(2)} ({rc.porcentaje}%)
              </div>
            ))}
          </div>
        </div>
      )}

      <h3>Listado de Gastos</h3>
      {cargando ? <p>Cargando gastos...</p> : (
        <table border={1} cellPadding={8} style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#ddd' }}>
              <th>Fecha</th>
              <th>Integrante</th>
              <th>Categoría</th>
              <th>Método Pago</th>
              <th>Descripción</th>
              <th>Monto</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {gastos.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center' }}>No hay gastos registrados en este periodo.</td></tr>
            ) : (
              gastos.map(g => (
                <tr key={g.id}>
                  <td>{g.fecha}</td>
                  <td>{g.integrante}</td>
                  <td>{g.categoria}</td>
                  <td>{g.metodo_pago || 'N/A'}</td>
                  <td>{g.descripcion || '-'}</td>
                  <td style={{ fontWeight: 'bold' }}>${Number(g.monto).toFixed(2)}</td>
                  <td>
                    {g.es_mio && (
                      <>
                        <button onClick={() => iniciarEdicion(g)}>Editar</button>
                        <button onClick={() => eliminarGasto(g.id)} style={{ marginLeft: '5px', color: 'red' }}>Eliminar</button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default Gastos;