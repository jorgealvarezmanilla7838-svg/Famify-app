// Mide los requisitos de rendimiento contra un servidor Famify que ya esté corriendo:
//   RNF09  operaciones comunes (consultar gastos, ingresos, presupuesto; registrar ingreso/gasto)  < 3 s
//   RNF10  reportes y resúmenes de un periodo de un año                                          < 10 s
//   RNF11  carga inicial de la pantalla principal con una conexión 4G                             < 5 s
//   RNF12  100 usuarios simultáneos sin errores y sin degradar de forma notable (p95 < 3 s)
//
// Uso (con el servidor encendido y un usuario que ya tenga familia):
//   PRUEBA_EMAIL=correo@ejemplo.com PRUEBA_PASSWORD=su_contraseña npm run prueba:rendimiento
//
// Por defecto la prueba SOLO LEE datos: no inserta, modifica ni borra nada en la base de datos.
// Variables opcionales:
//   API_URL            dirección del servidor (por defecto https://localhost:4000 si hay TLS_CERT en .env)
//   CONCURRENCIA       usuarios simultáneos de RNF12 (100)
//   DURACION           segundos que dura la carga de RNF12 (15)
//   REPETICIONES       repeticiones por operación en RNF09 (20)
//   PRUEBA_ESCRITURA=1 mide también registrar un ingreso y un gasto (RNF09); los borra al terminar
//   FRONT_URL          dirección del cliente compilado (npm run build && npm run preview) para medir RNF11 real
// El resultado también se guarda en docs/rendimiento/ultimo-resultado.md
const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const RAIZ = path.resolve(__dirname, '../..');
const CERT = process.env.TLS_CERT ? path.resolve(__dirname, '..', process.env.TLS_CERT) : null;
const API = process.env.API_URL || `${CERT ? 'https' : 'http'}://localhost:${process.env.PORT || 4000}`;

// RNF02_ Con el certificado de desarrollo se confía SOLO en ese certificado (no se desactiva la validación TLS)
if (API.startsWith('https') && CERT && fs.existsSync(CERT) && !process.env.NODE_EXTRA_CA_CERTS) {
  const r = spawnSync(process.execPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, NODE_EXTRA_CA_CERTS: CERT },
  });
  process.exit(r.status ?? 2);
}

const CONCURRENCIA = Number(process.env.CONCURRENCIA) || 100;
const DURACION_S = Number(process.env.DURACION) || 15;
const REPETICIONES = Number(process.env.REPETICIONES) || 20;

// Perfil de red 4G conservador (el "Slow 4G" que usa Lighthouse para móviles): 1.6 Mbps de bajada, 150 ms de latencia
const RED_4G = { bajadaBytesPorSeg: (1.6 * 1024 * 1024) / 8, rttMs: 150 };
// Tiempo reservado para que el navegador de un teléfono interprete el JavaScript y dibuje la pantalla
const PROCESAMIENTO_MS = 600;

const lineas = [];
const log = (texto = '') => {
  console.log(texto);
  lineas.push(texto);
};
const percentil = (valores, p) => {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.max(0, Math.ceil((p / 100) * orden.length) - 1))];
};
const fechaIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ms = (n) => `${n.toFixed(0)} ms`;

let fallos = 0;
const veredicto = (nombre, ok, detalle) => {
  if (!ok) fallos += 1;
  log(`| ${ok ? 'CUMPLE' : 'NO CUMPLE'} | ${nombre} | ${detalle} |`);
};

const llamar = async (ruta, token, opciones = {}) => {
  const inicio = performance.now();
  try {
    const res = await fetch(API + ruta, {
      method: opciones.metodo || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opciones.cuerpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
    });
    const texto = await res.text();
    return { ms: performance.now() - inicio, ok: res.ok, estado: res.status, texto };
  } catch (err) {
    return { ms: performance.now() - inicio, ok: false, estado: 0, texto: err.message };
  }
};

const medirSerie = async (ruta, token, veces) => {
  const tiempos = [];
  let errores = 0;
  for (let i = 0; i < veces; i += 1) {
    const r = await llamar(ruta, token);
    tiempos.push(r.ms);
    if (!r.ok) errores += 1;
  }
  return { tiempos, errores, max: Math.max(...tiempos), p95: percentil(tiempos, 95) };
};

// ---------- RNF11: tamaño de la carga inicial del cliente compilado ----------
const archivosIniciales = () => {
  const dist = path.join(RAIZ, 'client/dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    log('Compilando el cliente (npm run build) para medir la carga inicial...');
    execSync('npm run build', { cwd: path.join(RAIZ, 'client'), stdio: 'ignore', shell: true });
  }
  const html = fs.readFileSync(path.join(dist, 'index.html'));
  const rutas = [...html.toString().matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
  const gz = (buf) => zlib.gzipSync(buf, { level: 6 }).length;
  return {
    html: { nombre: 'index.html', bytes: gz(html) },
    recursos: rutas.map((r) => ({ nombre: r, bytes: gz(fs.readFileSync(path.join(dist, r))) })),
  };
};

const estimar4G = (bytes, viajes) => viajes * RED_4G.rttMs + (bytes / RED_4G.bajadaBytesPorSeg) * 1000;

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

  log(`# Prueba de rendimiento de Famify`);
  log();
  log(`- Fecha: ${new Date().toLocaleString('es-MX')}`);
  log(`- Servidor: ${API} (${API.startsWith('https') ? 'HTTPS/TLS' : 'HTTP sin cifrar'})`);
  log(`- Repeticiones RNF09: ${REPETICIONES} | Usuarios simultáneos RNF12: ${CONCURRENCIA} durante ${DURACION_S} s`);
  log();
  log('| Resultado | Requisito | Medición |');
  log('|---|---|---|');

  // Calentamiento: la primera petición abre conexiones y no representa el uso normal
  for (let i = 0; i < 3; i += 1) await llamar('/api/auth/me', token);

  // ---------- RNF09 ----------
  for (const [nombre, ruta] of [
    ['Consultar gastos del mes', `/api/gastos?${periodo}`],
    ['Consultar ingresos del mes', `/api/ingresos?${periodo}`],
    ['Consultar presupuesto', '/api/presupuestos'],
  ]) {
    const r = await medirSerie(ruta, token, REPETICIONES);
    veredicto(`RNF09 ${nombre} (< 3 s)`, r.errores === 0 && r.max < 3000, `máx ${ms(r.max)}, p95 ${ms(r.p95)}, errores ${r.errores}`);
  }

  if (process.env.PRUEBA_ESCRITURA === '1') {
    const ingreso = await llamar('/api/ingresos', token, {
      metodo: 'POST',
      cuerpo: { monto: 1, fuente: 'Prueba de rendimiento', tipo: 'otro', periodicidad: 'unico' },
    });
    if (ingreso.estado === 403) {
      log('| OMITIDO | RNF09 Registrar ingreso | el usuario de prueba no tiene permiso de registrar ingresos |');
    } else {
      veredicto('RNF09 Registrar ingreso (< 3 s)', ingreso.ok && ingreso.ms < 3000, `${ms(ingreso.ms)} (HTTP ${ingreso.estado})`);
      const id = JSON.parse(ingreso.texto || '{}').ingreso?.id ?? JSON.parse(ingreso.texto || '{}').id;
      if (id) await llamar(`/api/ingresos/${id}`, token, { metodo: 'DELETE' });
    }
    const catalogos = JSON.parse((await llamar('/api/gastos/catalogos', token)).texto || '{}');
    const categoriaId = (catalogos.categorias || [])[0]?.id;
    const gasto = await llamar('/api/gastos', token, {
      metodo: 'POST',
      cuerpo: { monto: 1, categoria_id: categoriaId, metodo_pago_id: 1, descripcion: 'Prueba de rendimiento' },
    });
    veredicto('RNF09 Registrar gasto (< 3 s)', gasto.ok && gasto.ms < 3000, `${ms(gasto.ms)} (HTTP ${gasto.estado})`);
    const idGasto = JSON.parse(gasto.texto || '{}').gasto?.id ?? JSON.parse(gasto.texto || '{}').id;
    if (idGasto) await llamar(`/api/gastos/${idGasto}`, token, { metodo: 'DELETE' });
  }

  // ---------- RNF10 ----------
  for (const [nombre, ruta] of [
    ['Reporte de ingresos y egresos de un año', `/api/reportes/ingresos-egresos?${periodoAnual}`],
    ['Resumen financiero de un año', `/api/reportes/resumen?${periodoAnual}`],
    ['Reporte por categoría de un año', `/api/reportes/categorias?${periodoAnual}`],
    ['Reporte familiar de un año', `/api/reportes/familiar?${periodoAnual}`],
  ]) {
    const r = await medirSerie(ruta, token, 3);
    veredicto(`RNF10 ${nombre} (< 10 s)`, r.errores === 0 && r.max < 10000, `máx ${ms(r.max)}, errores ${r.errores}`);
  }

  // ---------- RNF11 ----------
  const { html, recursos } = archivosIniciales();
  const bytesRecursos = recursos.reduce((s, r) => s + r.bytes, 0);
  const me = await medirSerie('/api/auth/me', token, 5);
  // conexión (TCP 1 + TLS 2 viajes) + HTML (1) ; recursos en paralelo (1) ;
  // API en otro puerto: conexión nueva (3) + verificación CORS (1) + petición (1) + tiempo del servidor
  const tiempoHtml = estimar4G(html.bytes, 4);
  const tiempoRecursos = estimar4G(bytesRecursos, 1);
  const tiempoApi = 5 * RED_4G.rttMs + me.p95;
  const total4G = tiempoHtml + tiempoRecursos + PROCESAMIENTO_MS + tiempoApi;
  veredicto(
    'RNF11 Carga inicial en 4G (< 5 s)',
    total4G < 5000,
    `${ms(total4G)} estimados: descarga ${((html.bytes + bytesRecursos) / 1024).toFixed(1)} KB comprimidos ` +
      `(${recursos.length + 1} archivos) a 1.6 Mbps/150 ms + ${PROCESAMIENTO_MS} ms de procesamiento + API ${ms(tiempoApi)}`
  );

  if (process.env.FRONT_URL) {
    const inicio = performance.now();
    const pagina = await fetch(process.env.FRONT_URL);
    const texto = await pagina.text();
    const rutas = [...texto.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    await Promise.all(rutas.map((r) => fetch(new URL(r, process.env.FRONT_URL)).then((x) => x.arrayBuffer())));
    await llamar('/api/auth/me', token);
    const real = performance.now() - inicio;
    veredicto('RNF11 Carga inicial medida en esta red (< 5 s)', pagina.ok && real < 5000, `${ms(real)} (${process.env.FRONT_URL})`);
  }

  // ---------- RNF12 ----------
  const mezcla = [
    `/api/gastos?${periodo}`,
    `/api/ingresos?${periodo}`,
    '/api/presupuestos',
    '/api/metas',
    '/api/notificaciones',
    `/api/reportes/resumen?${periodo}`,
  ];
  const cargar = async (usuarios, segundos) => {
    const fin = performance.now() + segundos * 1000;
    const tiempos = [];
    let errores = 0;
    const estados = {};
    await Promise.all(
      Array.from({ length: usuarios }, async (_, u) => {
        let i = u;
        while (performance.now() < fin) {
          const r = await llamar(mezcla[i % mezcla.length], token);
          i += 1;
          tiempos.push(r.ms);
          if (!r.ok) {
            errores += 1;
            estados[r.estado] = (estados[r.estado] || 0) + 1;
          }
        }
      })
    );
    return { tiempos, errores, estados, p95: percentil(tiempos, 95), p50: percentil(tiempos, 50), porSeg: tiempos.length / segundos };
  };

  const base = await cargar(1, 5);
  const carga = await cargar(CONCURRENCIA, DURACION_S);
  const factor = base.p95 > 0 ? carga.p95 / base.p95 : 0;
  veredicto(
    `RNF12 ${CONCURRENCIA} usuarios simultáneos (sin errores, p95 < 3 s)`,
    carga.errores === 0 && carga.p95 < 3000,
    `${carga.tiempos.length} peticiones en ${DURACION_S} s (${carga.porSeg.toFixed(0)}/s), p50 ${ms(carga.p50)}, ` +
      `p95 ${ms(carga.p95)} (con 1 usuario: ${ms(base.p95)}, x${factor.toFixed(1)}), errores ${carga.errores}` +
      (carga.errores ? ` ${JSON.stringify(carga.estados)}` : '')
  );

  log();
  log(fallos === 0 ? '**Todos los requisitos de rendimiento se cumplen.**' : `**${fallos} medición(es) no cumplen.**`);
  const carpeta = path.join(RAIZ, 'docs/rendimiento');
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(path.join(carpeta, 'ultimo-resultado.md'), lineas.join('\n') + '\n');
  console.log(`\nResultado guardado en docs/rendimiento/ultimo-resultado.md`);
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => {
  console.error('No se pudo medir:', err.message);
  process.exit(2);
});
