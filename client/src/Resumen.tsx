import { useCallback, useEffect, useState } from 'react';
import { pedir } from './api';
import { Avisos, Barra, Encabezado, SelectorPeriodo, useAvisos, usePeriodo } from './Comunes';
import { fechaVisible, moneda } from './formato';

// Resumen financiero (RF027 a RF031)

interface Totales { ingresos: number; gastos: number; balance: number; deficit: boolean }
interface DatosResumen {
  alcance_detalle: 'familia' | 'personal';
  totales: { familia: Totales; mio: Totales };
  categorias: { categoria_id: number; categoria: string; total: number; porcentaje: number }[];
  por_mes: { mes: string; ingresos: number; gastos: number }[];
  movimientos: { tipo: 'ingreso' | 'gasto'; fecha: string; monto: number; concepto: string; clasificacion: string; metodo_pago: string | null; integrante: string }[];
  metas: { id: number; nombre: string; monto_objetivo: number; monto_ahorrado: number; porcentaje: number; alcance: string; integrante: string | null }[];
}

export const Resumen = () => {
  const periodo = usePeriodo();
  const { desde, hasta } = periodo;
  const { errores, aviso, fallar, limpiar } = useAvisos();
  const [datos, setDatos] = useState<DatosResumen | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await pedir<DatosResumen>(`/api/reportes/resumen?desde=${desde}&hasta=${hasta}`);
      limpiar();
      setDatos(r);
    } catch (err) {
      fallar(err);
    }
  }, [desde, hasta, fallar, limpiar]);

  useEffect(() => {
    void Promise.resolve().then(cargar);
  }, [cargar]);

  const familia = datos?.totales.familia;
  const mayorCategoria = Math.max(0, ...(datos?.categorias.map((c) => c.total) ?? []));
  const mayorComparacion = Math.max(familia?.ingresos ?? 0, familia?.gastos ?? 0);

  return (
    <section className="modulo">
      <Encabezado titulo="Resumen financiero" descripcion="Cómo va la economía de la familia en el periodo." icono="▤" />
      <Avisos errores={errores} aviso={aviso} />

      <section className="modulo-consulta" aria-label="Periodo del resumen">
        <SelectorPeriodo periodo={periodo} titulo="Periodo" />
      </section>

      {familia?.deficit && (
        <p className="modulo-mensaje modulo-mensaje--error" role="alert">
          Déficit en este periodo: los gastos superan a los ingresos por {moneda(Math.abs(familia.balance))}.
        </p>
      )}

      {datos && familia && (
        <>
          <div className="modulo-cifras">
            <div className="modulo-cifra"><span>Ingresos</span><strong className="modulo-monto">{moneda(familia.ingresos)}</strong></div>
            <div className="modulo-cifra"><span>Gastos</span><strong className="modulo-monto--gasto">{moneda(familia.gastos)}</strong></div>
            <div className="modulo-cifra">
              <span>Balance disponible</span>
              <strong className={familia.balance < 0 ? 'modulo-monto--gasto' : 'modulo-monto'}>{moneda(familia.balance)}</strong>
            </div>
          </div>

          <section className="modulo-consulta" aria-label="Comparación de ingresos y egresos">
            <h4>Ingresos contra egresos</h4>
            <Barra etiqueta="Ingresos" detalle={moneda(familia.ingresos)} valor={familia.ingresos} maximo={mayorComparacion} estado="ingreso" />
            <Barra etiqueta="Egresos" detalle={moneda(familia.gastos)} valor={familia.gastos} maximo={mayorComparacion} estado="gasto" />
            <p className="modulo-nota">Tus movimientos: ingresos {moneda(datos.totales.mio.ingresos)}, gastos {moneda(datos.totales.mio.gastos)}.</p>
          </section>

          <section className="modulo-consulta" aria-label="Gastos por categoría">
            <h4>Gastos por categoría</h4>
            {datos.categorias.length === 0 && <p className="modulo-vacio">Sin gastos en este periodo.</p>}
            {datos.categorias.map((c) => (
              <Barra key={c.categoria_id} etiqueta={c.categoria} detalle={`${moneda(c.total)} (${c.porcentaje} %)`} valor={c.total} maximo={mayorCategoria} estado="gasto" />
            ))}
          </section>

          <section className="modulo-consulta" aria-label="Progreso de metas">
            <h4>Progreso de metas</h4>
            {datos.metas.length === 0 && <p className="modulo-vacio">Sin metas de ahorro.</p>}
            {datos.metas.map((m) => (
              <Barra key={m.id} etiqueta={`${m.nombre} · ${m.alcance === 'familia' ? 'Familia' : m.integrante ?? 'Personal'}`}
                detalle={`${moneda(m.monto_ahorrado)} de ${moneda(m.monto_objetivo)} (${m.porcentaje} %)`}
                valor={m.monto_ahorrado} maximo={m.monto_objetivo} estado="ingreso" />
            ))}
          </section>

          <section className="modulo-consulta" aria-label="Movimientos">
            <h4>{datos.alcance_detalle === 'familia' ? 'Movimientos de la familia' : 'Mis movimientos'}</h4>
            {datos.movimientos.length === 0 ? (
              <p className="modulo-vacio">Sin movimientos en este periodo.</p>
            ) : (
              <div className="modulo-tabla-contenedor">
                <table className="modulo-tabla">
                  <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Clasificación</th><th>Integrante</th><th>Monto</th></tr></thead>
                  <tbody>
                    {datos.movimientos.map((m, i) => (
                      <tr key={i}>
                        <td>{fechaVisible(m.fecha)}</td>
                        <td>{m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'}</td>
                        <td>{m.concepto}</td>
                        <td>{m.clasificacion}</td>
                        <td>{m.integrante}</td>
                        <td className={m.tipo === 'ingreso' ? 'modulo-monto' : 'modulo-monto modulo-monto--gasto'}>{moneda(m.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
};
