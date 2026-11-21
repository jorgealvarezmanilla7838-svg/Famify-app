import { useCallback, useEffect, useState, type FC, type FormEvent } from 'react';
import { pedir } from './api';
import { Avisos, Encabezado, useAvisos } from './Comunes';
import { fechaVisible } from './formato';

// Administración familiar (RF037 a RF040), invitaciones (RF03) y baja de cuenta (RNF32)

interface Integrante { id: number; nombre: string; email: string; rol_id: number; rol: string; desde: string; es_yo: boolean }
interface Permiso { clave: string; descripcion: string; permitido: boolean }

export const Administracion: FC<{ esAdmin: boolean; onBaja: () => void; onCambio: () => void }> = ({ esAdmin, onBaja, onCambio }) => {
  const { errores, aviso, limpiar, fallar, exito } = useAvisos();
  const [familia, setFamilia] = useState('');
  const [integrantes, setIntegrantes] = useState<Integrante[]>([]);
  const [miembros, setMiembros] = useState<{ id: number; nombre: string; rol: string }[]>([]);
  const [permisos, setPermisos] = useState<Permiso[]>([]);
  const [rolInvitado, setRolInvitado] = useState(2);
  const [correoInvitado, setCorreoInvitado] = useState('');
  const [codigo, setCodigo] = useState('');
  const [confirmacion, setConfirmacion] = useState('');

  const cargar = useCallback(async () => {
    try {
      if (esAdmin) {
        const [lista, listaPermisos] = await Promise.all([
          pedir('/api/administracion/integrantes'),
          pedir('/api/administracion/permisos'),
        ]);
        setFamilia(lista.familia);
        setIntegrantes(lista.integrantes);
        setPermisos(listaPermisos.permisos);
      } else {
        const lista = await pedir('/api/administracion/integrantes/nombres');
        setFamilia(lista.familia);
        setMiembros(lista.integrantes);
      }
    } catch (err) {
      fallar(err);
    }
  }, [esAdmin, fallar]);

  useEffect(() => {
    void Promise.resolve().then(cargar);
  }, [cargar]);

  const ejecutar = async (accion: () => Promise<{ message?: string }>) => {
    limpiar();
    try {
      const r = await accion();
      if (r.message) exito(r.message);
      // Si cambió el propio rol, el panel debe reflejarlo antes de recargar esta lista
      onCambio();
      await cargar();
    } catch (err) {
      fallar(err);
    }
  };

  const invitar = async (evento: FormEvent) => {
    evento.preventDefault();
    limpiar();
    setCodigo('');
    try {
      const r = await pedir('/api/auth/generar-invitacion', {
        metodo: 'POST',
        cuerpo: { rol_id: rolInvitado, email_invitado: correoInvitado },
      });
      setCodigo(r.codigo_invitacion);
      setCorreoInvitado('');
      exito(r.message);
    } catch (err) {
      fallar(err);
    }
  };

  const eliminar = (integrante: Integrante) => {
    if (!window.confirm(`¿Eliminar a ${integrante.nombre} de la familia? Sus datos personales se borrarán y no se pueden recuperar.`)) return;
    void ejecutar(() => pedir(`/api/administracion/integrantes/${integrante.id}`, { metodo: 'DELETE' }));
  };

  const darmeDeBaja = async (evento: FormEvent) => {
    evento.preventDefault();
    if (!window.confirm('Tu cuenta y tus datos personales se borrarán definitivamente. ¿Continuar?')) return;
    limpiar();
    try {
      await pedir('/api/administracion/cuenta', { metodo: 'DELETE', cuerpo: { confirmacion } });
      onBaja();
    } catch (err) {
      fallar(err);
    }
  };

  return (
    <section className="modulo">
      <Encabezado titulo={familia || 'Familia'} descripcion="Integrantes, roles y permisos." icono="⌂" />
      <Avisos errores={errores} aviso={aviso} />

      {esAdmin ? (
        <>
          <section className="modulo-consulta" aria-label="Integrantes">
            <h4>Integrantes</h4>
            <div className="modulo-tabla-contenedor">
              <table className="modulo-tabla">
                <thead><tr><th>Nombre</th><th>Correo</th><th>Desde</th><th>Rol</th><th>Acciones</th></tr></thead>
                <tbody>
                  {integrantes.map((i) => (
                    <tr key={i.id}>
                      <td>{i.nombre}{i.es_yo ? ' (tú)' : ''}</td>
                      <td>{i.email}</td>
                      <td>{fechaVisible(i.desde)}</td>
                      <td>
                        <select aria-label={`Rol de ${i.nombre}`} value={i.rol_id}
                          onChange={(e) => void ejecutar(() => pedir(`/api/administracion/integrantes/${i.id}/rol`, { metodo: 'PUT', cuerpo: { rol_id: Number(e.target.value) } }))}>
                          <option value={1}>Administrador</option>
                          <option value={2}>Integrante</option>
                        </select>
                      </td>
                      <td>
                        {!i.es_yo && (
                          <div className="modulo-acciones">
                            <button type="button" className="modulo-eliminar" onClick={() => eliminar(i)}>Eliminar</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <form className="modulo-formulario" onSubmit={invitar} noValidate>
            <h4>Invitar integrante</h4>
            <div className="modulo-campos">
              <label>
                Rol
                <select value={rolInvitado} onChange={(e) => setRolInvitado(Number(e.target.value))}>
                  <option value={2}>Integrante</option>
                  <option value={1}>Administrador</option>
                </select>
              </label>
              <label>
                Correo del invitado (opcional)
                <input type="email" placeholder="correo@ejemplo.com" value={correoInvitado} onChange={(e) => setCorreoInvitado(e.target.value)} />
              </label>
            </div>
            <div className="modulo-acciones-formulario">
              <button type="submit" className="modulo-boton modulo-boton--primario">Generar invitación</button>
            </div>
            {codigo && (
              <p className="modulo-nota">Código de un solo uso, válido por 48 horas: <span className="code-box">{codigo}</span></p>
            )}
          </form>

          <section className="modulo-consulta" aria-label="Permisos del rol integrante">
            <h4>Permisos del rol Integrante</h4>
            <p className="modulo-nota">El rol Administrador conserva siempre todos los permisos.</p>
            <ul className="modulo-lista">
              {permisos.map((p) => (
                <li key={p.clave} className="modulo-permiso">
                  <label>
                    <input type="checkbox" checked={p.permitido}
                      onChange={(e) => void ejecutar(() => pedir('/api/administracion/permisos', { metodo: 'PUT', cuerpo: { clave: p.clave, permitido: e.target.checked } }))} />
                    {p.descripcion}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <section className="modulo-consulta" aria-label="Integrantes">
          <h4>Integrantes</h4>
          <ul className="modulo-lista">
            {miembros.map((m) => <li key={m.id} className="modulo-permiso">{m.nombre} · {m.rol}</li>)}
          </ul>
        </section>
      )}

      <form className="modulo-formulario" onSubmit={darmeDeBaja} noValidate>
        <h4>Darme de baja</h4>
        <p className="modulo-nota">Se borran o anonimizan tus datos personales. Esta acción no se puede deshacer.</p>
        <div className="modulo-campos">
          <label>
            Escribe ELIMINAR para confirmar
            <input type="text" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
          </label>
        </div>
        <div className="modulo-acciones-formulario">
          <button type="submit" className="modulo-boton modulo-boton--peligro">Eliminar mi cuenta</button>
        </div>
      </form>
    </section>
  );
};
