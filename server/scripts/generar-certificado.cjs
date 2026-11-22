// RNF02: crea un certificado autofirmado para probar Famify por HTTPS/TLS en tu computadora y en tu red local.
// Uso: npm run tls:generar   (necesita OpenSSL; viene con Git para Windows, macOS y Linux)
// El certificado incluye localhost, 127.0.0.1 y las IP de red de esta computadora, así que también sirve
// cuando abres Famify desde otra máquina (por ejemplo Kali en una máquina virtual).
// Para agregar otro nombre o IP: TLS_HOSTS=mi-pc.local,10.0.0.5 npm run tls:generar
// Después agrega a server/.env:   TLS_CERT=certs/famify.crt   y   TLS_KEY=certs/famify.key
// El navegador mostrará una advertencia porque el certificado no lo emite una autoridad real.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = path.resolve(__dirname, '../certs');
fs.mkdirSync(carpeta, { recursive: true });
const clave = path.join(carpeta, 'famify.key');
const certificado = path.join(carpeta, 'famify.crt');

const ipsDeRed = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i.address);
const extras = (process.env.TLS_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
const esIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
const nombres = [...new Set(['localhost', '127.0.0.1', ...ipsDeRed, ...extras])];
const san = nombres.map((h) => (esIp(h) ? `IP:${h}` : `DNS:${h}`)).join(',');

// Configuración mínima propia: así no importa si OPENSSL_CONF apunta a un archivo que no existe
// (pasa, por ejemplo, cuando el instalador de PostgreSQL/psqlODBC deja esa variable configurada)
const configuracion = path.join(os.tmpdir(), 'famify-openssl.cnf');
fs.writeFileSync(configuracion, '[req]\ndistinguished_name = dn\n[dn]\n');

try {
  execFileSync(
    process.env.OPENSSL_PATH || 'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '365',
      '-keyout', clave, '-out', certificado,
      '-subj', '/CN=localhost/O=Famify (desarrollo)',
      '-addext', `subjectAltName=${san}`,
      '-addext', 'extendedKeyUsage=serverAuth',
    ],
    { stdio: 'inherit', env: { ...process.env, OPENSSL_CONF: configuracion } }
  );
  console.log(`\nCertificado creado en server/certs/ para: ${nombres.join(', ')}`);
  console.log('Agrega a server/.env:');
  console.log('  TLS_CERT=certs/famify.crt');
  console.log('  TLS_KEY=certs/famify.key');
  console.log('El cliente (npm run dev en client) detecta el certificado y también se sirve por HTTPS.');
} catch (err) {
  console.error('No se pudo crear el certificado. ¿Está OpenSSL instalado? Puedes indicar su ruta en OPENSSL_PATH.');
  process.exit(1);
}
