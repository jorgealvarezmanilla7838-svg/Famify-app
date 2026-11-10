import React, { useEffect, useRef, useState } from 'react';
import './Auth.css';
import { EVENTO_SESION_EXPIRADA, ErrorApi, pedir } from './api';
import { AvisoPrivacidad } from './AvisoPrivacidad';
import { Cuestionario } from './Cuestionario';
import { Panel } from './Panel';

type Mensaje = { texto: string; tipo: 'success' | 'error' };

const codigoDeUrl = () => new URLSearchParams(window.location.search).get('codigo') ?? '';

const textoError = (err: unknown) =>
  err instanceof ErrorApi ? err.errores.join(' ') : 'Ocurrió un problema. Intenta de nuevo.';

export const Auth: React.FC = () => {
  // RF04 / RNF06: el enlace de invitación trae el código en la dirección
  const [modo, setModo] = useState<'login' | 'register'>(() => (codigoDeUrl() ? 'register' : 'login'));
  const [codigoInvitacion, setCodigoInvitacion] = useState(codigoDeUrl);
  const [mensaje, setMensaje] = useState<Mensaje | null>(() =>
    codigoDeUrl()
      ? { texto: 'Enlace de invitación detectado. Completa tu registro para unirte a la familia.', tipo: 'success' }
      : null
  );
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [aceptaAviso, setAceptaAviso] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [usuario, setUsuario] = useState<any>(null);
  const [restaurando, setRestaurando] = useState(() => Boolean(localStorage.getItem('token')));
  const [nombreFamilia, setNombreFamilia] = useState('');
  // Mientras se cierra la sesión, un rechazo de otra consulta en curso no significa que expiró
  const cerrandoSesion = useRef(false);

  // Conserva la sesión al recargar la página
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    pedir('/api/auth/me')
      .then((r) => setUsuario(r.user))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setRestaurando(false));
  }, []);

  // RNF05: si el servidor dio por terminada la sesión, se regresa al inicio
  useEffect(() => {
    const alExpirar = () => {
      if (cerrandoSesion.current) return;
      localStorage.removeItem('token');
      setUsuario(null);
      setMensaje({ texto: 'Tu sesión expiró por inactividad. Inicia sesión nuevamente.', tipo: 'error' });
    };
    window.addEventListener(EVENTO_SESION_EXPIRADA, alExpirar);
    return () => window.removeEventListener(EVENTO_SESION_EXPIRADA, alExpirar);
  }, []);

  const unirseAFamilia = async () =>
    pedir('/api/auth/unirse-familia', { metodo: 'POST', cuerpo: { codigo_invitacion: codigoInvitacion } });

  // RF01 / RF04
  const handleSubmitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setMensaje(null);
    try {
      const data = await pedir(modo === 'login' ? '/api/auth/login' : '/api/auth/register', {
        metodo: 'POST',
        cuerpo: modo === 'login' ? { email, password } : { nombre, email, password, acepta_aviso: aceptaAviso },
      });
      localStorage.setItem('token', data.token);
      let usuarioActual = data.user;
      let aviso: Mensaje = { texto: data.message, tipo: 'success' };

      if (codigoInvitacion) {
        try {
          const unido = await unirseAFamilia();
          usuarioActual = { ...usuarioActual, familia_id: unido.familia.id, rol_id: unido.rol_id };
          aviso = { texto: `Te uniste a la familia "${unido.familia.nombre}".`, tipo: 'success' };
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (err) {
          aviso = { texto: `Tu cuenta está lista, pero la invitación falló: ${textoError(err)}`, tipo: 'error' };
        }
      }
      setPassword('');
      setMensaje(aviso);
      setUsuario(usuarioActual);
    } catch (err) {
      setMensaje({ texto: textoError(err), tipo: 'error' });
    }
  };

  // RF02
  const handleCrearFamilia = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = await pedir('/api/auth/crear-familia', { metodo: 'POST', cuerpo: { nombre_familia: nombreFamilia } });
      setMensaje({ texto: 'Familia creada con éxito.', tipo: 'success' });
      setUsuario({ ...usuario, familia_id: data.familia.id, rol_id: 1 });
    } catch (err) {
      setMensaje({ texto: textoError(err), tipo: 'error' });
    }
  };

  // RF04
  const handleUnirseFamilia = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const unido = await unirseAFamilia();
      setMensaje({ texto: 'Te uniste a la familia correctamente.', tipo: 'success' });
      setUsuario({ ...usuario, familia_id: unido.familia.id, rol_id: unido.rol_id });
    } catch (err) {
      setMensaje({ texto: textoError(err), tipo: 'error' });
    }
  };

  const salir = (texto: string) => {
    localStorage.removeItem('token');
    setUsuario(null);
    setMensaje({ texto, tipo: 'success' });
  };

  // RNF05: el servidor invalida el token antes de borrarlo del navegador
  const handleCerrarSesion = async () => {
    cerrandoSesion.current = true;
    await pedir('/api/auth/logout', { metodo: 'POST' }).catch(() => undefined);
    salir('Sesión cerrada correctamente.');
    cerrandoSesion.current = false;
  };

  if (restaurando) return null;

  if (usuario?.familia_id && usuario.perfil_completo !== false) {
    return (
      <Panel
        usuario={usuario}
        onCerrarSesion={() => void handleCerrarSesion()}
        onBaja={() => salir('Tu cuenta fue eliminada.')}
      />
    );
  }

  return (
    <div className={`auth-container${usuario?.familia_id ? ' auth-container--ancho' : ''}`}>
      <div className="auth-header">
        <h1 className="auth-marca">Famify</h1>
      </div>

      {mensaje && (
        <div className={`alert-box ${mensaje.tipo === 'success' ? 'alert-success' : 'alert-error'}`} role={mensaje.tipo === 'error' ? 'alert' : 'status'}>
          {mensaje.texto}
        </div>
      )}

      {!usuario ? (
        <div>
          <form onSubmit={handleSubmitAuth} className="auth-form" noValidate>
            <h2>{modo === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</h2>

            {modo === 'register' && (
              <div className="form-group">
                <label htmlFor="nombre">Nombre completo</label>
                <input id="nombre" type="text" className="form-input" autoComplete="name" value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="correo">Correo electrónico</label>
              <input id="correo" type="email" className="form-input" autoComplete="email" placeholder="correo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="form-group">
              <label htmlFor="contrasena">Contraseña{modo === 'register' ? ' (mínimo 8 caracteres)' : ''}</label>
              <input id="contrasena" type="password" className="form-input" autoComplete={modo === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {codigoInvitacion && (
              <div className="form-group">
                <label htmlFor="codigo">Código de invitación</label>
                <input id="codigo" type="text" className="form-input" value={codigoInvitacion} readOnly />
              </div>
            )}

            {modo === 'register' && (
              <div className="form-group">
                <AvisoPrivacidad />
                <label className="aviso-aceptar">
                  <input type="checkbox" checked={aceptaAviso} onChange={(e) => setAceptaAviso(e.target.checked)} />
                  He leído y acepto el aviso de privacidad
                </label>
              </div>
            )}

            <button type="submit" className="btn-primary">
              {modo === 'login' ? 'Entrar' : codigoInvitacion ? 'Crear cuenta y unirme' : 'Crear cuenta'}
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
          <h2>Hola, {usuario.nombre || usuario.email}</h2>

          {!usuario.familia_id ? (
            <div className="card-section">
              <h3>Opciones de familia</h3>
              <form onSubmit={handleCrearFamilia} className="auth-form" style={{ marginBottom: '20px' }} noValidate>
                <label htmlFor="familia" className="auth-etiqueta">Nombre de la nueva familia</label>
                <input id="familia" type="text" className="form-input" value={nombreFamilia} onChange={(e) => setNombreFamilia(e.target.value)} />
                <button type="submit" className="btn-secondary">Crear nueva familia</button>
              </form>

              <form onSubmit={handleUnirseFamilia} className="auth-form" noValidate>
                <label htmlFor="codigo-union" className="auth-etiqueta">Código de invitación</label>
                <input id="codigo-union" type="text" className="form-input" value={codigoInvitacion} onChange={(e) => setCodigoInvitacion(e.target.value)} />
                <button type="submit" className="btn-secondary">Unirme con código</button>
              </form>
            </div>
          ) : (
            // RF05 a RF08: cuestionario para completar el registro
            <Cuestionario
              nombre={usuario.nombre || ''}
              onCompletado={(datos) => {
                setUsuario({ ...usuario, perfil_completo: true, recibe_sueldo: datos.recibe_sueldo });
                setMensaje(null);
              }}
            />
          )}

          <div style={{ marginTop: '24px' }}>
            <button onClick={() => void handleCerrarSesion()} className="btn-danger">Cerrar sesión</button>
          </div>
        </div>
      )}
    </div>
  );
};
