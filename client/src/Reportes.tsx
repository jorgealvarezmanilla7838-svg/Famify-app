import { useEffect, useState, type FC } from 'react';
import { pedir } from './api';
import { Avisos, Barra, Encabezado, SelectorPeriodo, useAvisos, usePeriodo } from './Comunes';
import { fechaVisible, moneda } from './formato';

// Reportes financieros (RF041 a RF043)

type TipoReporte = 'movimientos' | 'categorias' | 'familiar';
interface Opcion { id: number | string; nombre: string }
interface Movimiento { tipo: 'ingreso' | 'gasto'; fecha: string; monto: number; concepto: string; clasificacion: string; metodo_pago: string | null; integrante: string }
interface Categoria { categoria_id: number; categoria: string; total: number; porcentaje: number }

// Evita que una celda se interprete como fórmula al abrir el archivo en Excel
const celda = (valor: string | number) => {
  const texto = String(valor);
  const seguro = /^[=+\-@]/.test(texto) && !/^-\d+(\.\d+)?$/.test(texto) ? `'${texto}` : texto;
  return `"${seguro.replace(/"/g, '""')}"`;
};

const descargarCsv = (nombre: string, filas: (string | number)[][]) => {
  const contenido = '﻿' + filas.map((f) => f.map(celda).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  URL.revokeObjectURL(url);
};

export const Reportes: FC<{ esAdmin: boolean }> = ({ esAdmin }) => {
  const periodo = usePeriodo();
  const { desde, hasta } = periodo;
  const { errores, aviso, limpiar, fallar } = useAvisos();
  const [tipo, setTipo] = useState<TipoReporte>('movimientos');
  const [categorias, setCategorias] = useState<Opcion[]>([]);
  const [integrantes, setIntegrantes] = useState<Opcion[]>([]);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroIntegrante, setFiltroIntegrante] = useState('');
  const [movimientos, setMovimientos] = useState<{ total_ingresos: number; total_gastos: number; movimientos: Movimiento[] } | null>(null);
  const [porCategoria, setPorCategoria] = useState<{ total: number; categorias: Categoria[] } | null>(null);
  const [familiar, setFamiliar] = useState<{ ingresos: number; gastos: number; balance: number; deficit: boolean; por_mes: { mes: string; ingresos: number; gastos: number }[] } | null>(null);

  useEffect(() => {
    pedir('/api/gastos/catalogos').then((r) => setCategorias(r.categorias)).catch(fallar);
    if (esAdmin) pedir('/api/administracion/integrantes/nombres').then((r) => setIntegrantes(r.integrantes)).catch(fallar);
  }, [esAdmin, fallar]);

  useEffect(() => {
    const periodoConsulta = `desde=${desde}&hasta=${hasta}`;
    const generar = async () => {
      try {
        if (tipo === 'movimientos') {
          const filtros = new URLSearchParams();
          if (filtroTipo) filtros.set('tipo', filtroTipo);
          if (filtroCategoria && filtroTipo !== 'ingreso') filtros.set('categoria_id', filtroCategoria);
          if (filtroIntegrante) filtros.set('usuario_id', filtroIntegrante);
          setMovimientos(await pedir(`/api/reportes/ingresos-egresos?${periodoConsulta}&${filtros}`));
        } else if (tipo === 'categorias') {
          setPorCategoria(await pedir(`/api/reportes/categorias?${periodoConsulta}`));
        } else {
          setFamiliar(await pedir(`/api/reportes/familiar?${periodoConsulta}`));
        }
        limpiar();
      } catch (err) {
        fallar(err);
      }
    };
    void generar();
  }, [tipo, desde, hasta, filtroTipo, filtroCategoria, filtroIntegrante, fallar, limpiar]);

  const exportar = () => {
    const sufijo = `${desde}_${hasta}.csv`;
    if (tipo === 'movimientos' && movimientos) {
      descargarCsv(`reporte-movimientos_${sufijo}`, [
        ['Fecha', 'Tipo', 'Concepto', 'Clasificación', 'Método de pago', 'Integrante', 'Monto (MXN)'],
        ...movimientos.movimientos.map((m) => [fechaVisible(m.fecha), m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto', m.concepto, m.clasificacion, m.metodo_pago ?? '', m.integrante, m.monto.toFixed(2)]),
      ]);
    } else if (tipo === 'categorias' && porCategoria) {
      descargarCsv(`reporte-categorias_${sufijo}`, [
        ['Categoría', 'Total (MXN)', 'Porcentaje'],
        ...porCategoria.categorias.map((c) => [c.categoria, c.total.toFixed(2), c.porcentaje]),
      ]);
    } else if (tipo === 'familiar' && familiar) {
      descargarCsv(`reporte-familiar_${sufijo}`, [
        ['Mes', 'Ingresos (MXN)', 'Gastos (MXN)', 'Balance (MXN)'],
        ...familiar.por_mes.map((m) => [m.mes, m.ingresos.toFixed(2), m.gastos.toFixed(2), (m.ingresos - m.gastos).toFixed(2)]),
      ]);
    }
  };

  const mayor = Math.max(0, ...(porCategoria?.categorias.map((c) => c.total) ?? []));

  return (
    <section className="modulo">
      <Encabezado titulo="Reportes financieros" descripcion="Genera reportes por periodo y descárgalos." icono="▦" />
      <Avisos errores={errores} aviso={aviso} />

      <section className="modulo-consulta" aria-label="Opciones del reporte">
        <SelectorPeriodo periodo={periodo} titulo="Periodo del reporte" />
        <div className="modulo-campos modulo-campos--separado">
          <label>
            Reporte
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoReporte)}>
              <option value="movimientos">Ingresos y egresos</option>
              <option value="categorias">Gastos por categoría</option>
              <option value="familiar">Financiero familiar</option>
            </select>
          </label>
          {tipo === 'movimientos' && (
            <>
              <label>
                Movimientos
                <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                  <option value="">Todos</option>
                  <option value="ingreso">Solo ingresos</option>
                  <option value="gasto">Solo gastos</option>
                </select>
              </label>
              <label>
                Categoría de gasto
                <select value={filtroCategoria} disabled={filtroTipo === 'ingreso'} onChange={(e) => setFiltroCategoria(e.target.value)}>
                  <option value="">Todas</option>
                  {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </label>
              {esAdmin && (
                <label>
                  Integrante
                  <select value={filtroIntegrante} onChange={(e) => setFiltroIntegrante(e.target.value)}>
                    <option value="">Todos</option>
                    {integrantes.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
                  </select>
                </label>
              )}
            </>
          )}
        </div>
        <div className="modulo-acciones-formulario">
          <button type="button" className="modulo-boton modulo-boton--primario" onClick={exportar}>Descargar CSV</button>
          <button type="button" className="modulo-boton" onClick={() => window.print()}>Imprimir</button>
        </div>
      </section>

      {tipo === 'movimientos' && movimientos && (
        <section className="modulo-consulta">
          <div className="modulo-resumen">
            <div><span>Ingresos</span><strong>{moneda(movimientos.total_ingresos)}</strong></div>
            <div><span>Egresos</span><strong>{moneda(movimientos.total_gastos)}</strong></div>
            <div><span>Movimientos</span><strong>{movimientos.movimientos.length}</strong></div>
          </div>
          {movimientos.movimientos.length === 0 ? (
            <p className="modulo-vacio">No hay movimientos con estos filtros.</p>
          ) : (
            <div className="modulo-tabla-contenedor">
              <table className="modulo-tabla">
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Clasificación</th><th>Método</th><th>Integrante</th><th>Monto</th></tr></thead>
                <tbody>
                  {movimientos.movimientos.map((m, i) => (
                    <tr key={i}>
                      <td>{fechaVisible(m.fecha)}</td>
                      <td>{m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'}</td>
                      <td>{m.concepto}</td>
                      <td>{m.clasificacion}</td>
                      <td>{m.metodo_pago ?? '—'}</td>
                      <td>{m.integrante}</td>
                      <td className={m.tipo === 'ingreso' ? 'modulo-monto' : 'modulo-monto modulo-monto--gasto'}>{moneda(m.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tipo === 'categorias' && porCategoria && (
        <section className="modulo-consulta">
          <div className="modulo-resumen"><div><span>Total gastado</span><strong>{moneda(porCategoria.total)}</strong></div></div>
          {porCategoria.categorias.length === 0 && <p className="modulo-vacio">Sin gastos en este periodo.</p>}
          {porCategoria.categorias.map((c) => (
            <Barra key={c.categoria_id} etiqueta={c.categoria} detalle={`${moneda(c.total)} (${c.porcentaje} %)`} valor={c.total} maximo={mayor} estado="gasto" />
          ))}
        </section>
      )}

      {tipo === 'familiar' && familiar && (
        <section className="modulo-consulta">
          {familiar.deficit && <p className="modulo-mensaje modulo-mensaje--error" role="alert">La familia presenta déficit en este periodo.</p>}
          <div className="modulo-resumen">
            <div><span>Ingresos</span><strong>{moneda(familiar.ingresos)}</strong></div>
            <div><span>Gastos</span><strong>{moneda(familiar.gastos)}</strong></div>
            <div><span>Balance</span><strong>{moneda(familiar.balance)}</strong></div>
          </div>
          {familiar.por_mes.length > 0 && (
            <div className="modulo-tabla-contenedor">
              <table className="modulo-tabla">
                <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Balance</th></tr></thead>
                <tbody>
                  {familiar.por_mes.map((m) => (
                    <tr key={m.mes}>
                      <td>{m.mes.slice(5)}/{m.mes.slice(0, 4)}</td>
                      <td>{moneda(m.ingresos)}</td>
                      <td>{moneda(m.gastos)}</td>
                      <td>{moneda(m.ingresos - m.gastos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </section>
  );
};
