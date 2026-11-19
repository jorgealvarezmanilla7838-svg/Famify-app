// Mide los requisitos de rendimiento contra un servidor Famify que ya esté corriendo:
//   RNF09  operaciones comunes (consultar gastos, ingresos y presupuesto)  < 3 s
//   RNF10  reporte de un año completo                                      < 10 s
//   RNF12  100 usuarios simultáneos sin errores y sin degradar (p95 < 3 s)
//
// Uso (con el servidor encendido y un usuario que ya tenga familia):
//   PRUEBA_EMAIL=correo@ejemplo.com PRUEBA_PASSWORD=su_contraseña npm run prueba:rendimiento
// Variables opcionales: API_URL (http://localhost:4000), CONCURRENCIA (100), REPETICIONES (20).
// Si usas el certificado autofirmado: NODE_TLS_REJECT_UNAUTHORIZED=0
const API = process.env.API_URL || 'http://localhost:4000';
const CONCURRENCIA = Number(process.env.CONCURRENCIA) || 100;
const REPETICIONES = Number(process.env.REPETICIONES) || 20;

const percentil = (valores, p) => {
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)];
};
const fechaIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

let fallos = 0;
const veredicto = (nombre, ok, detalle) => {
  if (!ok) fallos += 1;
  console.log(`${ok ? 'CUMPLE   ' : 'NO CUMPLE'}  ${nombre}  ${detalle}`);
};

const llamar = async (ruta, token) => {
  const inicio = performance.now();
  const res = await fetch(API + ruta, { headers: { Authorization: `Bearer ${token}` } });
  await res.text();
  return { ms: performance.now() - inicio, ok: res.ok, estado: res.status };
};

(async () => {
  if (!process.env.PRUEBA_EMAIL || !process.env.PRUEBA_PASSWORD) {
    throw new Error('Define PRUEBA_EMAIL y PRUEBA_PASSWORD (un usuario existente con familia).');
  }
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.PRUEBA_EMAIL, password: process.env.PRUEBA_PASSWORD }),
  });
  const datos = await login.json();
  if (!login.ok || !datos.token) throw new Error(`No se pudo iniciar sesión: ${datos.error || login.status}`);
  const token = datos.token;

  const hoy = new Date();
  const haceUnAnio = new Date(hoy.getFullYear() - 1, hoy.getMonth(), hoy.getDate() + 1);
  const periodo = `desde=${fechaIso(new Date(hoy.getFullYear(), hoy.getMonth(), 1))}&hasta=${fechaIso(hoy)}`;
  const periodoAnual = `desde=${fechaIso(haceUnAnio)}&hasta=${fechaIso(hoy)}`;
  console.log(`Servidor: ${API} | repeticiones: ${REPETICIONES} | concurrencia: ${CONCURRENCIA}\n`);

  // RNF09
  for (const [nombre, ruta] of [
    ['Consultar gastos', `/api/gastos?${periodo}`],
    ['Consultar ingresos', `/api/ingresos?${periodo}`],
    ['Consultar presupuesto', '/api/presupuestos'],
  ]) {
    const tiempos = [];
    let errores = 0;
    for (let i = 0; i < REPETICIONES; i += 1) {
      const r = await llamar(ruta, token);
      tiempos.push(r.ms);
      if (!r.ok) errores += 1;
    }
    const max = Math.max(...tiempos);
    veredicto(`RNF09 ${nombre}`, errores === 0 && max < 3000, `máx ${max.toFixed(0)} ms, p95 ${percentil(tiempos, 95).toFixed(0)} ms, errores ${errores}`);
  }

  // RNF10
  const reporte = await llamar(`/api/reportes/ingresos-egresos?${periodoAnual}`, token);
  veredicto('RNF10 Reporte de un año', reporte.ok && reporte.ms < 10000, `${reporte.ms.toFixed(0)} ms (HTTP ${reporte.estado})`);
  const resumen = await llamar(`/api/reportes/resumen?${periodoAnual}`, token);
  veredicto('RNF10 Resumen de un año', resumen.ok && resumen.ms < 10000, `${resumen.ms.toFixed(0)} ms (HTTP ${resumen.estado})`);

  // RNF12
  const inicio = performance.now();
  const resultados = await Promise.all(Array.from({ length: CONCURRENCIA }, () => llamar(`/api/gastos?${periodo}`, token)));
  const total = performance.now() - inicio;
  const errores = resultados.filter((r) => !r.ok).length;
  const p95 = percentil(resultados.map((r) => r.ms), 95);
  veredicto(`RNF12 ${CONCURRENCIA} peticiones simultáneas`, errores === 0 && p95 < 3000, `errores ${errores}, p95 ${p95.toFixed(0)} ms, total ${total.toFixed(0)} ms`);

  console.log(fallos === 0 ? '\nTodos los requisitos de rendimiento se cumplen.' : `\n${fallos} medición(es) no cumplen.`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => {
  console.error('No se pudo medir:', err.message);
  process.exit(2);
});
