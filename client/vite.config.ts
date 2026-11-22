import fs from 'node:fs'
import { Agent } from 'node:https'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type ProxyOptions } from 'vite'

// RNF02: si existe el certificado de desarrollo (npm run tls:generar en server), el cliente también se sirve por HTTPS
const clave = path.resolve(import.meta.dirname, '../server/certs/famify.key')
const certificado = path.resolve(import.meta.dirname, '../server/certs/famify.crt')
const https = fs.existsSync(clave) && fs.existsSync(certificado)
  ? { key: fs.readFileSync(clave), cert: fs.readFileSync(certificado) }
  : undefined

// El navegador solo habla con este servidor (un solo origen y un solo certificado que aceptar);
// las peticiones a /api se reenvían al backend. Con TLS, el reenvío también va cifrado y solo
// confía en el certificado de Famify (no se desactiva la validación).
const destinoApi = process.env.FAMIFY_API_DESTINO || `${https ? 'https' : 'http'}://localhost:4000`
const proxy: Record<string, ProxyOptions> = {
  '/api': {
    target: destinoApi,
    changeOrigin: true,
    ...(https && destinoApi.startsWith('https') ? { agent: new Agent({ ca: https.cert, keepAlive: true }) } : {}),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // host: true permite abrir Famify desde otra computadora de la red (por ejemplo, Kali)
  server: { https, host: true, proxy },
  // RNF11_ vite preview sirve la versión compilada (la que se mide para la carga inicial)
  preview: { https, host: true, proxy },
})
