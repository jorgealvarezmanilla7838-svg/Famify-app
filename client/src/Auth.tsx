import React, { useState, useEffect } from 'react';
import './Auth.css';
import { Cuestionario } from './Cuestionario';
import { Ingresos } from './Ingresos';

export const Auth: React.FC = () => {
  const [modo, setModo] = useState<'login' | 'register'>('login');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usuario, setUsuario] = useState<any>(null);
  const [nombreFamilia, setNombreFamilia] = useState('');
  const [codigoInvitacion, setCodigoInvitacion] = useState('');
  const [codigoGenerado, setCodigoGenerado] = useState('');
  const [rolAAsignar, setRolAAsignar] = useState<number>(2);
  const [emailInvitado, setEmailInvitado] = useState('');
  const [estadoFamilia, setEstadoFamilia] = useState<any>(null);
  const [verEstado, setVerEstado] = useState<boolean>(false);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'success' | 'error' } | null>(null);

  // RNF06: Detectar si el usuario abrió la página desde un enlace de invitación
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codigoUrl = params.get('codigo');
    if (codigoUrl) {
      setCodigoInvitacion(codigoUrl);
      setModo('register');
      setMensaje({
        texto: '¡Enlace de invitación detectado! Completa tu registro para unirte a la familia.',
        tipo: 'success',
      });
    }
  }, []);

  const getTokenHeader = () => {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  };

  // RF01 / RF04: Autenticación con Token (RNF05)
  const handleSubmitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje(null);

    const endpoint = modo === 'login' ? '/api/auth/login' : '/api/auth/register';
    const bodyData = modo === 'login' ? { email, password } : { nombre, email, password };

    try {
      const res = await fetch(`http://localhost:4000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData),
      });

      const data = await res.json();

      if (!res.ok) {
        setMensaje({ texto: data.error, tipo: 'error' });
        return;
      }

      if (data.token) {
        localStorage.setItem('token', data.token);
      }

      let userObj = data.user;

      // RF04: Si venía con código de invitación, unirse automáticamente
      if (codigoInvitacion && userObj) {
        try {
          const resUnir = await fetch('http://localhost:4000/api/auth/unirse-familia', {
            method: 'POST',
            headers: getTokenHeader(),
            body: JSON.stringify({ usuario_id: userObj.id, codigo_invitacion: codigoInvitacion }),
          });
          const dataUnir = await resUnir.json();
          if (resUnir.ok) {
            userObj = { ...userObj, familia_id: dataUnir.familia.id, rol_id: dataUnir.rol_id };
            setMensaje({ texto: `¡Cuenta creada y vinculado a la familia "${dataUnir.familia.nombre}"!`, tipo: 'success' });
            window.history.replaceState({}, document.title, window.location.pathname);
          } else {
            setMensaje({ texto: `Cuenta creada, pero hubo un detalle con la invitación: ${dataUnir.error}`, tipo: 'error' });
          }
        } catch (errUnir) {
          console.error(errUnir);
        }
      } else {
        setMensaje({ texto: data.message, tipo: 'success' });
      }

      setUsuario(userObj);
    } catch (err) {
      setMensaje({ texto: 'Error de conexión con el servidor backend.', tipo: 'error' });
    }
  };

  // RF02: Crear Familia
  const handleCrearFamilia = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:4000/api/auth/crear-familia', {
        method: 'POST',
        headers: getTokenHeader(),
        body: JSON.stringify({ usuario_id: usuario.id, nombre_familia: nombreFamilia }),
      });
      const data = await res.json();
      if (res.ok) {
        setMensaje({ texto: `Familia creada con éxito.`, tipo: 'success' });
        setCodigoGenerado(data.familia.codigo_invitacion);
        setUsuario({ ...usuario, familia_id: data.familia.id, rol_id: 1 });
      } else {
        setMensaje({ texto: data.error, tipo: 'error' });
      }
    } catch (err) {
      setMensaje({ texto: 'Error al crear la familia', tipo: 'error' });
    }
  };

  // RF03: Generar invitación (RNF03: Solo Administradores)
  const handleGenerarInvitacion = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:4000/api/auth/generar-invitacion', {
        method: 'POST',
        headers: getTokenHeader(),
        body: JSON.stringify({
          usuario_id: usuario.id,
          rol_id: Number(rolAAsignar),
          email_invitado: emailInvitado,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setCodigoGenerado(data.codigo_invitacion);
        setMensaje({ texto: data.message, tipo: 'success' });
      } else {
        setMensaje({ texto: data.error, tipo: 'error' });
      }
    } catch (err) {
      setMensaje({ texto: 'Error al generar la invitación', tipo: 'error' });
    }
  };

  // RF04: Unirse a Familia manualmente con código
  const handleUnirseFamilia = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('http://localhost:4000/api/auth/unirse-familia', {
        method: 'POST',
        headers: getTokenHeader(),
        body: JSON.stringify({ usuario_id: usuario.id, codigo_invitacion: codigoInvitacion }),
      });
      const data = await res.json();
      if (res.ok) {
        setMensaje({ texto: `Te has unido a la familia exitosamente.`, tipo: 'success' });
        setUsuario({ ...usuario, familia_id: data.familia.id, rol_id: data.rol_id });
      } else {
        setMensaje({ texto: data.error, tipo: 'error' });
      }
    } catch (err) {
      setMensaje({ texto: 'Error al unirse a la familia', tipo: 'error' });
    }
  };

  // RNF04: Consultar Estado de la Familia
  const handleObtenerEstadoFamilia = async () => {
    if (!usuario?.familia_id) return;
    try {
      const res = await fetch(`http://localhost:4000/api/auth/estado-familia/${usuario.familia_id}`, {
        headers: getTokenHeader(),
      });
      const data = await res.json();
      if (res.ok) {
        setEstadoFamilia(data);
        setVerEstado(!verEstado);
      } else {
        setMensaje({ texto: data.error, tipo: 'error' });
      }
    } catch (err) {
      setMensaje({ texto: 'Error al obtener el estado de la familia', tipo: 'error' });
    }
  };

  // RNF05: Cierre de sesión eliminando el token de autenticación
  const handleCerrarSesion = () => {
    localStorage.removeItem('token');
    setUsuario(null);
    setMensaje({ texto: 'Sesión cerrada correctamente.', tipo: 'success' });
    setCodigoGenerado('');
    setVerEstado(false);
  };

  return (
    <div className={`auth-container${usuario?.familia_id && usuario.perfil_completo === false ? ' auth-container--ancho' : ''}`}>
      <div className="auth-header">
        <h2>Famify</h2>
        {/* RF01 - Módulo 1: Gestión de Usuarios (Oculto en interfaz) */}
      </div>

      {mensaje && (
        <div className={`alert-box ${mensaje.tipo === 'success' ? 'alert-success' : 'alert-error'}`}>
          {mensaje.texto}
        </div>
      )}

      {!usuario ? (
        <div>
          <form onSubmit={handleSubmitAuth} className="auth-form">
            <h3>{modo === 'login' ? 'Iniciar Sesión' : 'Registro de Usuario'}</h3>

            {modo === 'register' && (
              <div className="form-group">
                <label>Nombre Completo</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Ej. Jorge Álvarez"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label>Correo Electrónico</label>
              <input
                type="email"
                className="form-input"
                placeholder="correo@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Contraseña</label>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {codigoInvitacion && (
              <div className="form-group">
                <label style={{ color: '#27ae60' }}>Código de Invitación Aplicado:</label>
                <input type="text" className="form-input" value={codigoInvitacion} readOnly />
              </div>
            )}

            <button type="submit" className="btn-primary">
              {modo === 'login' ? 'Entrar' : 'Crear Cuenta y Unirme'}
            </button>
          </form>

          <button
            onClick={() => {
              setModo(modo === 'login' ? 'register' : 'login');
              setMensaje(null);
            }}
            className="btn-link"
          >
            {modo === 'login' ? '¿No tienes cuenta? Regístrate aquí' : '¿Ya tienes cuenta? Inicia sesión'}
          </button>
        </div>
      ) : (
        <div>
          <h3>Hola, {usuario.nombre || usuario.email}!</h3>
          <p style={{ fontSize: '0.9rem', color: '#555' }}>
            <strong>ID Usuario:</strong> {usuario.id} <br />
            <strong>Familia ID:</strong> {usuario.familia_id ? usuario.familia_id : 'Sin asignar'} <br />
            <strong>Rol:</strong> {Number(usuario.rol_id) === 1 ? '👑 Administrador' : '👤 Integrante'}
          </p>

          {!usuario.familia_id ? (
            <div className="card-section">
              <h4>Opciones de Familia</h4>
              <form onSubmit={handleCrearFamilia} className="auth-form" style={{ marginBottom: '20px' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Nombre de la nueva familia"
                  value={nombreFamilia}
                  onChange={(e) => setNombreFamilia(e.target.value)}
                  required
                />
                <button type="submit" className="btn-secondary">
                  Crear Nueva Familia
                </button>
              </form>

              <form onSubmit={handleUnirseFamilia} className="auth-form">
                <input
                  type="text"
                  className="form-input"
                  placeholder="Código de invitación"
                  value={codigoInvitacion}
                  onChange={(e) => setCodigoInvitacion(e.target.value)}
                  required
                />
                <button type="submit" className="btn-secondary">
                  Unirme con Código
                </button>
              </form>
            </div>
          ) : usuario.perfil_completo === false ? (
            // RF05 a RF08: cuestionario para completar el registro (administrador e integrantes)
            <Cuestionario
              nombre={usuario.nombre || ''}
              onCompletado={(datos) => {
                setUsuario({ ...usuario, perfil_completo: true, recibe_sueldo: datos.recibe_sueldo });
                setMensaje({ texto: '¡Listo! Tu perfil quedó completo.', tipo: 'success' });
              }}
            />
          ) : (
            <div>
              {/* Botón de Estado de la Familia */}
              <div className="card-section">
                <button onClick={handleObtenerEstadoFamilia} className="btn-primary" style={{ width: '100%' }}>
                  {verEstado ? 'Ocultar Estado de Familia' : '📊 Ver Estado de la Familia'}
                </button>

                {verEstado && estadoFamilia && (
                  <div style={{ marginTop: '16px' }}>
                    <h4>Familia: {estadoFamilia.familia.nombre}</h4>
                    <p style={{ fontSize: '0.85rem', color: '#666' }}>
                      <strong>Total de Miembros:</strong> {estadoFamilia.total_miembros}
                    </p>
                    <ul style={{ paddingLeft: '18px', fontSize: '0.9rem' }}>
                      {estadoFamilia.miembros.map((m: any) => (
                        <li key={m.id} style={{ marginBottom: '6px' }}>
                          <strong>{m.nombre}</strong> ({m.email}) - <span style={{ color: m.rol === 'administrador' ? '#d35400' : '#2980b9' }}>{m.rol}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Sección de Invitación (Solo Administradores) */}
              {Number(usuario.rol_id) === 1 && (
                <div className="card-section">
                  <h4>Invitar nuevo integrante</h4>
                  <form onSubmit={handleGenerarInvitacion} className="auth-form">
                    <div className="form-group">
                      <label>Asignar Rol Familiar:</label>
                      <select
                        className="form-input"
                        value={rolAAsignar}
                        onChange={(e) => setRolAAsignar(Number(e.target.value))}
                      >
                        <option value={2}>Integrante (Permisos estándar)</option>
                        <option value={1}>Administrador (Permisos totales)</option>
                      </select>
                    </div>

                    <div className="form-group">
                      <label>Correo del invitado (Opcional):</label>
                      <input
                        type="email"
                        className="form-input"
                        placeholder="correo@invitado.com"
                        value={emailInvitado}
                        onChange={(e) => setEmailInvitado(e.target.value)}
                      />
                    </div>

                    <button type="submit" className="btn-secondary">
                      Generar Código y Enviar por Correo
                    </button>
                  </form>

                  {codigoGenerado && (
                    <div style={{ marginTop: '16px' }}>
                      <label style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>
                        Código de Invitación Generado:
                      </label>
                      <div className="code-box">{codigoGenerado}</div>
                    </div>
                  )}

                </div>
              )}
              <Ingresos />
            </div>
          )}

          <div style={{ marginTop: '24px' }}>
            <button onClick={handleCerrarSesion} className="btn-danger">
              Cerrar Sesión
            </button>
          </div>
        </div>
      )}
    </div>
  );
};