import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// RNF02: si existe el certificado de desarrollo (npm run tls:generar en server), el cliente también se sirve por HTTPS
const clave = path.resolve(__dirname, '../server/certs/famify.key')
const certificado = path.resolve(__dirname, '../server/certs/famify.crt')
const https = fs.existsSync(clave) && fs.existsSync(certificado)
  ? { key: fs.readFileSync(clave), cert: fs.readFileSync(certificado) }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { https },
})
