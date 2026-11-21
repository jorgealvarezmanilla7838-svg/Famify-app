import { useCallback, useEffect, useState, type FC } from 'react';
import { pedir } from './api';
import { Avisos, Encabezado, useAvisos } from './Comunes';
import { fechaVisible } from './formato';

// Notificaciones y recordatorios (RF032 a RF036)

interface Notificacion { id: number | string; tipo: string; titulo: string; mensaje: string; leida: boolean; fecha: string }

const etiquetas: Record<string, string> = {
  corte: 'Fecha de corte',
  limite_pago: 'Límite de pago',
  gasto_fijo: 'Gasto fijo',
  presupuesto: 'Presupuesto',
  deficit: 'Déficit',
};

export const Notificaciones: FC<{ onCambio: () => void }> = ({ onCambio }) => {
  const { errores, aviso, fallar } = useAvisos();
  const [lista, setLista] = useState<Notificacion[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    try {
      const r = await pedir('/api/notificaciones');
      setLista(r.notificaciones);
    } catch (err) {
      fallar(err);
    } finally {
      setCargando(false);
    }
  }, [fallar]);

  useEffect(() => {
    void Promise.resolve().then(cargar);
  }, [cargar]);

  const marcar = async (ruta: string) => {
    try {
      await pedir(`/api/notificaciones/${ruta}`, { metodo: 'POST' });
      await cargar();
      onCambio();
    } catch (err) {
      fallar(err);
    }
  };

  return (
    <section className="modulo">
      <Encabezado titulo="Notificaciones" descripcion="Recordatorios de pagos y alertas de tu economía." icono="!" />
      <Avisos errores={errores} aviso={aviso} />

      <section className="modulo-consulta">
        {lista.some((n) => !n.leida) && (
          <div className="modulo-acciones-formulario">
            <button type="button" className="modulo-boton" onClick={() => void marcar('leer-todas')}>Marcar todas como leídas</button>
          </div>
        )}
        {cargando ? (
          <p className="modulo-vacio">Cargando notificaciones…</p>
        ) : lista.length === 0 ? (
          <p className="modulo-vacio">No tienes notificaciones.</p>
        ) : (
          <ul className="modulo-lista">
            {lista.map((n) => (
              <li key={n.id} className={n.leida ? 'modulo-aviso' : 'modulo-aviso modulo-aviso--nuevo'}>
                <div>
                  <span className="modulo-etiqueta">{etiquetas[n.tipo] ?? 'Aviso'}</span>
                  <strong>{n.titulo}</strong>
                  <p>{n.mensaje}</p>
                  <small>{fechaVisible(n.fecha)}</small>
                </div>
                {!n.leida && (
                  <button type="button" className="modulo-boton" onClick={() => void marcar(`${n.id}/leer`)}>Marcar como leída</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
};
