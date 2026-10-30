import { useCallback, useEffect, useState } from 'react';
import './Auth.css';
import { Auth } from './Auth';
import { Cuestionario } from './Cuestionario';
import { Ingresos } from './Ingresos';
import Gastos from './Gastos';

interface UsuarioActual {
  id: number;
  nombre: string;
  email: string;
  rol_id: number | null;
  familia_id: number | null;
  perfil_completo: boolean;
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [vista, setVista] = useState<'familia' | 'gastos' | 'ingresos'>('familia');
  // datos del usuario leídos del servidor (no del token, que puede estar viejo)
  const [usuario, setUsuario] = useState<UsuarioActual | null>(null);
  const [cargandoUsuario, setCargandoUsuario] = useState<boolean>(Boolean(localStorage.getItem('token')));

  const cerrarSesion = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUsuario(null);
    setVista('familia');
  }, []);

  // Cada vez que entra un token (login, registro, invitación aceptada o recarga de la página)
  // se consulta al servidor quién es el usuario y si ya completó el cuestionario (RF04)
  useEffect(() => {
    if (!token) {
      setUsuario(null);
      setCargandoUsuario(false);
      return;
    }
    let activo = true;
    setCargandoUsuario(true);
    fetch('http://localhost:4000/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json();
        if (!activo) return;
        if (res.ok && data.success) {
          setUsuario(data.user);
        } else {
          cerrarSesion(); // token vencido o usuario dado de baja
        }
      })
      .catch(() => {
        if (activo) setUsuario(null);
      })
      .finally(() => {
        if (activo) setCargandoUsuario(false);
      });
    return () => {
      activo = false;
    };
  }, [token, cerrarSesion]);

  if (!token) {
    return <Auth onLogin={(nuevoToken: string) => setToken(nuevoToken)} />;
  }

  if (cargandoUsuario) {
    return <p style={{ textAlign: 'center', marginTop: '60px', fontFamily: 'sans-serif' }}>Cargando...</p>;
  }

  // RF04_ mientras el perfil no esté completo, solo se muestra el cuestionario (RF05 a RF08)
  // Aplica igual al administrador que a los integrantes que llegan por invitación
  if (usuario && !usuario.perfil_completo) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f4f6f8', padding: '24px 12px' }}>
        <div className="auth-container auth-container--ancho">
          <Cuestionario
            nombre={usuario.nombre}
            onCompletado={() => setUsuario({ ...usuario, perfil_completo: true })}
          />
          <div style={{ textAlign: 'center', marginTop: '12px' }}>
            <button type="button" className="btn-link" onClick={cerrarSesion}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'sans-serif', minHeight: '100vh', backgroundColor: '#f4f6f8' }}>
      {/* Barra de Navegación Principal */}
      <nav style={{ 
        background: '#1e293b', 
        color: '#fff', 
        padding: '12px 24px', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
      }}>
        <h1 style={{ margin: 0, fontSize: '20px', color: '#38bdf8' }}>Famify App</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button 
            onClick={() => setVista('familia')} 
            style={{ 
              padding: '8px 14px', 
              background: vista === 'familia' ? '#0284c7' : '#334155', 
              color: '#fff', 
              border: 'none', 
              borderRadius: '6px', 
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            👨‍👩‍👧‍👦 Administrar Familia
          </button>
          <button 
            onClick={() => setVista('gastos')} 
            style={{ 
              padding: '8px 14px', 
              background: vista === 'gastos' ? '#0284c7' : '#334155', 
              color: '#fff', 
              border: 'none', 
              borderRadius: '6px', 
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            📉 Gestión de Gastos / Egresos
          </button>
          <button 
            onClick={() => setVista('ingresos')} 
            style={{ 
              padding: '8px 14px', 
              background: vista === 'ingresos' ? '#0284c7' : '#334155', 
              color: '#fff', 
              border: 'none', 
              borderRadius: '6px', 
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            📈 Gestión de Ingresos
          </button>
          <button 
            onClick={cerrarSesion} 
            style={{ 
              padding: '8px 14px', 
              background: '#ef4444', 
              color: '#fff', 
              border: 'none', 
              borderRadius: '6px', 
              cursor: 'pointer',
              marginLeft: '15px' 
            }}
          >
            Cerrar Sesión
          </button>
        </div>
      </nav>

      {/* Contenido Dinámico */}
      <main style={{ padding: '24px' }}>
        {vista === 'familia' && <Auth token={token} />}
        {vista === 'gastos' && <Gastos token={token} />}
        {vista === 'ingresos' && <Ingresos />}
      </main>
    </div>
  );
}

export default App;