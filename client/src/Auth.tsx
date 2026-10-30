import React, { useState, useEffect } from 'react';

interface AuthProps {
  onLogin?: (token: string) => void;
  token?: string | null;
}

export const Auth: React.FC<AuthProps> = ({ onLogin, token }) => {
  const queryParams = new URLSearchParams(window.location.search);
  const codigoDesdeUrl = queryParams.get('codigo') || '';

  const [esLogin, setEsLogin] = useState(!codigoDesdeUrl);
  // Datos de usuario
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Gestión de familia
  const [nombreFamilia, setNombreFamilia] = useState('');
  const [codigoInvitacion, setCodigoInvitacion] = useState(codigoDesdeUrl);
  const [rolId, setRolId] = useState(2);
  const [emailInvitado, setEmailInvitado] = useState('');

  // Datos de respuesta
  const [estadoFamilia, setEstadoFamilia] = useState<any>(null);
  const [codigoGenerado, setCodigoGenerado] = useState('');
  const [enlaceGenerado, setEnlaceGenerado] = useState('');

  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [tokenSesion, setTokenSesion] = useState<string | null>(null);

  const tokenActivo = token || tokenSesion || localStorage.getItem('token');

  const cargarEstadoFamilia = async (tokenUsar: string, familiaIdManual?: number) => {
    try {
      let famId = familiaIdManual;

      // el token puede estar viejo (por ejemplo si se creó o se unió a una familia después de iniciar sesión),
      // por eso si no trae familia se le pregunta al servidor, que lee la base de datos
      if (!famId && tokenUsar) {
        try {
          const base64 = tokenUsar.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          const payload = JSON.parse(atob(base64));
          famId = payload.familia_id ? Number(payload.familia_id) : undefined;
        } catch {
          famId = undefined;
        }
      }
      if (!famId && tokenUsar) {
        const resMe = await fetch('http://localhost:4000/api/auth/me', {
          headers: { Authorization: `Bearer ${tokenUsar}` }
        });
        const dataMe = await resMe.json();
        if (dataMe.success && dataMe.user?.familia_id) famId = Number(dataMe.user.familia_id);
      }

      if (famId) {
        const res = await fetch(`http://localhost:4000/api/auth/estado-familia/${famId}`, {
          headers: { Authorization: `Bearer ${tokenUsar}` }
        });
        const data = await res.json();
        if (data.success) {
          setEstadoFamilia(data);
        }
      }
    } catch (err) {
      console.error('Error al cargar estado de la familia:', err);
    }
  };

  // Devuelve el token renovado (ya con la familia) o, si falla, el motivo
  const autoUnirConCodigo = async (
    tokenUsar: string,
    codigo: string
  ): Promise<{ token: string | null; error?: string }> => {
    try {
      const res = await fetch('http://localhost:4000/api/auth/unirse-familia', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUsar}`
        },
        body: JSON.stringify({ codigo_invitacion: codigo })
      });
      const data = await res.json();
      if (data.success && data.token) {
        localStorage.setItem('token', data.token);
        setTokenSesion(data.token);
        window.history.replaceState({}, document.title, window.location.pathname);
        return { token: data.token };
      }
      return { token: null, error: data.error || 'No se pudo usar la invitación.' };
    } catch (err) {
      console.error('Error al unirse automáticamente con el código:', err);
      return { token: null, error: 'No se pudo usar la invitación (error de conexión).' };
    }
  };

  useEffect(() => {
    if (tokenActivo) {
      cargarEstadoFamilia(tokenActivo);
    }
  }, [tokenActivo]);

  // si la invitación falló justo al registrarse, se avisa aquí (el código sigue escrito para reintentar)
  useEffect(() => {
    const aviso = sessionStorage.getItem('famify_aviso_union');
    if (aviso && token) {
      setError(aviso);
      sessionStorage.removeItem('famify_aviso_union');
    }
  }, [token]);

  // Manejador de submit de Formulario
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMensaje('');
    setCargando(true);

    const url = esLogin
      ? 'http://localhost:4000/api/auth/login'
      : 'http://localhost:4000/api/auth/register';

    const body = esLogin
      ? { email, password }
      : { nombre, email, password };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (data.success && data.token) {
        let tokenFinal = data.token;
        localStorage.setItem('token', tokenFinal);
        setTokenSesion(tokenFinal);

        // Si se está uniendo con código de invitación, se canjea ANTES de entrar a la app
        // para que el token que se guarda ya incluya la familia
        if (codigoInvitacion) {
          const union = await autoUnirConCodigo(data.token, codigoInvitacion);
          if (union.token) {
            tokenFinal = union.token;
          } else if (union.error) {
            sessionStorage.setItem('famify_aviso_union', union.error);
          }
        }

        // App.tsx revisa en el servidor si falta contestar el cuestionario (RF04)
        // y lo muestra antes de la pantalla de la familia
        if (onLogin) onLogin(tokenFinal);
      } else {
        setError(data.error || 'Ocurrió un error en la autenticación.');
      }
    } catch (err) {
      setError('Error de conexión con el servidor.');
    } finally {
      setCargando(false);
    }
  };

  const handleCrearFamilia = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMensaje('');

    try {
      const res = await fetch('http://localhost:4000/api/auth/crear-familia', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenActivo}`
        },
        body: JSON.stringify({ nombre_familia: nombreFamilia })
      });
      const data = await res.json();
      if (data.success && data.familia?.id) {
        setMensaje(data.message);
        if (tokenActivo) cargarEstadoFamilia(tokenActivo, data.familia.id);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Error al crear la familia.');
    }
  };

  const handleGenerarInvitacion = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMensaje('');

    try {
      const res = await fetch('http://localhost:4000/api/auth/generar-invitacion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenActivo}`
        },
        body: JSON.stringify({
          rol_id: Number(rolId),
          email_invitado: emailInvitado || undefined
        })
      });
      const data = await res.json();
      if (data.success) {
        setMensaje(data.message);
        setCodigoGenerado(data.codigo_invitacion);
        setEnlaceGenerado(data.enlace);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Error al generar la invitación.');
    }
  };

  const handleUnirseFamilia = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMensaje('');

    try {
      const res = await fetch('http://localhost:4000/api/auth/unirse-familia', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenActivo}`
        },
        body: JSON.stringify({ codigo_invitacion: codigoInvitacion })
      });
      const data = await res.json();
      if (data.success && data.familia?.id) {
        if (data.token) {
          localStorage.setItem('token', data.token);
          setTokenSesion(data.token);
        }
        setMensaje(data.message);
        cargarEstadoFamilia(data.token || tokenActivo || '', Number(data.familia.id));
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Error al unirse a la familia.');
    }
  };

  const handleDarDeBaja = async () => {
    const confirmacion = window.confirm(
      '⚠️ ¿Estás seguro de que deseas borrar tu cuenta?\n\nEsta acción eliminará tus credenciales y anonimizará tus registros en la plataforma. No se puede deshacer.'
    );

    if (!confirmacion) return;

    try {
      const res = await fetch('http://localhost:4000/api/auth/dar-de-baja', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenActivo}`
        }
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        localStorage.removeItem('token');
        window.location.reload();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Error al intentar dar de baja la cuenta.');
    }
  };

  // ---------------------------------------------------------------------
  // PANTALLA 1: Registro / Login
  // ---------------------------------------------------------------------
  if (!token) {
    return (
      <div style={{ maxWidth: '400px', margin: '50px auto', padding: '20px', background: '#fff', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <h2 style={{ textAlign: 'center', color: '#1e293b' }}>Famify</h2>
        <h3 style={{ textAlign: 'center', color: '#64748b' }}>{esLogin ? 'Iniciar Sesión' : 'Crear Cuenta e Integrarse'}</h3>

        {codigoInvitacion && !esLogin && (
          <div style={{ background: '#e0f2fe', color: '#0369a1', padding: '10px', borderRadius: '6px', fontSize: '13px', marginBottom: '12px', textAlign: 'center' }}>
            🎉 Te han invitado a unirte a una familia. Registra tus datos a continuación.
          </div>
        )}

        {error && <div style={{ color: '#ef4444', marginBottom: '10px', fontSize: '14px', textAlign: 'center' }}>{error}</div>}

        <form onSubmit={handleAuthSubmit}>
          {!esLogin && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px' }}>Nombre completo:</label>
              <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} required style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }} />
            </div>
          )}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>Correo Electrónico:</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }} />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>Contraseña:</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }} />
          </div>

          {codigoInvitacion && !esLogin && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '4px' }}>Código de Invitación:</label>
              <input type="text" value={codigoInvitacion} readOnly style={{ width: '100%', padding: '8px', background: '#f1f5f9', border: '1px solid #cbd5e1', boxSizing: 'border-box', fontWeight: 'bold' }} />
            </div>
          )}

          <button type="submit" disabled={cargando} style={{ width: '100%', padding: '10px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
            {cargando ? 'Procesando...' : esLogin ? 'Entrar' : 'Registrarse y Unirme'}
          </button>
        </form>

        <div style={{ marginTop: '15px', textAlign: 'center' }}>
          <button onClick={() => { setEsLogin(!esLogin); setError(''); }} style={{ background: 'none', border: 'none', color: '#0284c7', cursor: 'pointer', textDecoration: 'underline' }}>
            {esLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // PANTALLA 2: Panel de Administración de Familia
  // ---------------------------------------------------------------------
  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', background: '#c0c0c0', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <h2>👨‍👩‍👧‍👦 Administración de la Familia</h2>

      {mensaje && <div style={{ background: '#dcfce7', color: '#15803d', padding: '10px', borderRadius: '6px', marginBottom: '15px' }}>{mensaje}</div>}
      {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '10px', borderRadius: '6px', marginBottom: '15px' }}>{error}</div>}

      {estadoFamilia ? (
        <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
          <h3 style={{ marginTop: 0 }}>Familia: {estadoFamilia.familia.nombre}</h3>
          <p><strong>Total de miembros:</strong> {estadoFamilia.total_miembros}</p>
          <h4>Miembros del núcleo familiar:</h4>
          <ul style={{ paddingLeft: '20px' }}>
            {estadoFamilia.miembros.map((m: any) => (
              <li key={m.id} style={{ marginBottom: '6px' }}>
                <strong>{m.nombre}</strong> ({m.email}) - <em>Rol: {m.rol}</em>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
          <form onSubmit={handleCrearFamilia} style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px' }}>
            <h4>Crear una Familia Nueva</h4>
            <input type="text" placeholder="Nombre de la familia" value={nombreFamilia} onChange={e => setNombreFamilia(e.target.value)} required style={{ width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
            <button type="submit" style={{ padding: '8px 16px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Crear Familia</button>
          </form>

          <form onSubmit={handleUnirseFamilia} style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px' }}>
            <h4>Unirse con Código</h4>
            <input type="text" placeholder="Código de invitación" value={codigoInvitacion} onChange={e => setCodigoInvitacion(e.target.value)} required style={{ width: '100%', padding: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
            <button type="submit" style={{ padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Unirme</button>
          </form>
        </div>
      )}

      <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginTop: '20px' }}>
        <h3>Invitar nuevo integrante</h3>
        <form onSubmit={handleGenerarInvitacion}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>Asignar Rol Familiar:</label>
            <select value={rolId} onChange={e => setRolId(Number(e.target.value))} style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}>
              <option value={1}>Administrador</option>
              <option value={2}>Integrante (Permisos estándar)</option>
            </select>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px' }}>Correo del invitado (Opcional):</label>
            <input type="email" placeholder="correo@invitado.com" value={emailInvitado} onChange={e => setEmailInvitado(e.target.value)} style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }} />
          </div>
          <button type="submit" style={{ padding: '10px 16px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Generar Código y Enviar por Correo</button>
        </form>

        {codigoGenerado && (
          <div style={{ marginTop: '15px', background: '#fff', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
            <p><strong>Código de invitación generado:</strong> <code style={{ fontSize: '16px', color: '#0284c7' }}>{codigoGenerado}</code></p>
            <p><strong>Enlace directo:</strong> <a href={enlaceGenerado} target="_blank" rel="noreferrer">{enlaceGenerado}</a></p>
          </div>
        )}
      </div>

      <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #e2e8f0', textAlign: 'right' }}>
        <button
          onClick={handleDarDeBaja}
          style={{
            padding: '10px 18px',
            background: '#dc2626',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          🗑️ Borrar mi cuenta
        </button>
      </div>
    </div>
  );
};