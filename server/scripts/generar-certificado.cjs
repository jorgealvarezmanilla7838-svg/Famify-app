// RNF02: crea un certificado autofirmado para probar Famify por HTTPS en tu computadora.
// Uso: npm run tls:generar   (necesita OpenSSL; viene con Git para Windows, macOS y Linux)
// Después agrega a server/.env:   TLS_CERT=certs/famify.crt   y   TLS_KEY=certs/famify.key
// El navegador mostrará una advertencia porque el certificado no lo emite una autoridad real.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const carpeta = path.resolve(__dirname, '../certs');
fs.mkdirSync(carpeta, { recursive: true });
const clave = path.join(carpeta, 'famify.key');
const certificado = path.join(carpeta, 'famify.crt');

try {
  execFileSync(
    process.env.OPENSSL_PATH || 'openssl',
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
      '-keyout', clave, '-out', certificado,
      '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ],
    { stdio: 'inherit' }
  );
  console.log('\nCertificado creado en server/certs/. Agrega a server/.env:');
  console.log('  TLS_CERT=certs/famify.crt');
  console.log('  TLS_KEY=certs/famify.key');
  console.log('  CLIENT_URL=https://localhost:5173');
  console.log('y en client/.env:  VITE_API_URL=https://localhost:4000');
} catch (err) {
  console.error('No se pudo crear el certificado. ¿Está OpenSSL instalado? Puedes indicar su ruta en OPENSSL_PATH.');
  process.exit(1);
}
