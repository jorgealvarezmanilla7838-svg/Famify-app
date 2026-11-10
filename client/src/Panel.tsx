import { useCallback, useEffect, useState, type FC } from 'react';
import { pedir } from './api';
import { Administracion } from './Administracion';
import { Cuestionario } from './Cuestionario';
import { Gastos } from './Gastos';
import { Ingresos } from './Ingresos';
import { Metas } from './Metas';
import { Notificaciones } from './Notificaciones';
import { Presupuesto } from './Presupuesto';
import { Reportes } from './Reportes';
import { Resumen } from './Resumen';
import './Modulos.css';

// Estructura de navegación común a todas las pantallas (RNF19)

type Seccion = 'resumen' | 'ingresos' | 'gastos' | 'presupuesto' | 'metas' | 'reportes' | 'avisos' | 'familia' | 'configuracion';

interface Props {
  usuario: { id: number; nombre: string; email: string; rol_id: number; familia_id: number };
  onCerrarSesion: () => void;
  onBaja: () => void;
}

export const Panel: FC<Props> = ({ usuario, onCerrarSesion, onBaja }) => {
  const [permisos, setPermisos] = useState<string[] | null>(null);
  const [rolId, setRolId] = useState(Number(usuario.rol_id));
  const [elegida, setElegida] = useState<Seccion | null>(null);
  const [sinLeer, setSinLeer] = useState(0);
  const esAdmin = rolId === 1;

  // Rol y permisos pueden cambiar mientras la sesión sigue abierta (RF038, RF039)
  const actualizarAcceso = useCallback(async () => {
    try {
      const r = await pedir('/api/auth/me');
      setPermisos(r.permisos);
      setRolId(Number(r.user.rol_id));
    } catch {
      setPermisos((actuales) => actuales ?? []);
    }
  }, []);

  const contarAvisos = useCallback(async () => {
    try {
      const r = await pedir('/api/notificaciones', { sondeo: true });
      setSinLeer(r.sin_leer);
    } catch {
      // El conteo es informativo; si falla se reintenta en el siguiente ciclo
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(actualizarAcceso);
    void Promise.resolve().then(contarAvisos);
    const temporizador = setInterval(() => void contarAvisos(), 60000);
    return () => clearInterval(temporizador);
  }, [actualizarAcceso, contarAvisos]);

  if (!permisos) return <p className="modulo-vacio">Cargando…</p>;

  const puedeReportes = permisos.includes('reportes.ver');
  const opciones: { id: Seccion; texto: string }[] = [
    ...(puedeReportes ? [{ id: 'resumen' as const, texto: 'Resumen' }] : []),
    { id: 'ingresos', texto: 'Ingresos' },
    { id: 'gastos', texto: 'Gastos' },
    { id: 'presupuesto', texto: 'Presupuesto' },
    { id: 'metas', texto: 'Metas' },
    ...(puedeReportes ? [{ id: 'reportes' as const, texto: 'Reportes' }] : []),
    { id: 'avisos', texto: 'Notificaciones' },
    { id: 'familia', texto: 'Familia' },
    { id: 'configuracion', texto: 'Mi configuración' },
  ];
  const seccion = elegida && opciones.some((o) => o.id === elegida) ? elegida : opciones[0]!.id;

  const elegir = (id: Seccion) => {
    setElegida(id);
    void actualizarAcceso();
  };

  return (
    <div className="panel">
      <header className="panel-superior">
        <div>
          <h1 className="panel-marca">Famify</h1>
          <p className="modulo-nota">{usuario.nombre} · {esAdmin ? 'Administrador' : 'Integrante'}</p>
        </div>
        <button type="button" className="modulo-boton" onClick={onCerrarSesion}>Cerrar sesión</button>
      </header>

      <nav className="panel-menu" aria-label="Secciones">
        {opciones.map((o) => (
          <button key={o.id} type="button" aria-current={seccion === o.id ? 'page' : undefined}
            className={seccion === o.id ? 'panel-opcion panel-opcion--activa' : 'panel-opcion'}
            onClick={() => elegir(o.id)}>
            {o.texto}
            {o.id === 'avisos' && sinLeer > 0 && <span className="panel-contador" aria-label={`${sinLeer} sin leer`}>{sinLeer}</span>}
          </button>
        ))}
      </nav>

      <main>
        {seccion === 'resumen' && <Resumen />}
        {seccion === 'ingresos' && <Ingresos permisos={permisos} />}
        {seccion === 'gastos' && <Gastos esAdmin={esAdmin} permisos={permisos} />}
        {seccion === 'presupuesto' && <Presupuesto permisos={permisos} />}
        {seccion === 'metas' && <Metas permisos={permisos} esAdmin={esAdmin} />}
        {seccion === 'reportes' && <Reportes esAdmin={esAdmin} />}
        {seccion === 'avisos' && <Notificaciones onCambio={() => void contarAvisos()} />}
        {seccion === 'familia' && <Administracion esAdmin={esAdmin} onBaja={onBaja} onCambio={() => void actualizarAcceso()} />}
        {seccion === 'configuracion' && (
          <section className="modulo">
            <Cuestionario nombre={usuario.nombre} edicion onCompletado={() => void actualizarAcceso()} />
          </section>
        )}
      </main>
    </div>
  );
};
