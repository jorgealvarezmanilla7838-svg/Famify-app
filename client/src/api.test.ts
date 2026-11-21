// Comunicación con el servidor: token, sondeos (RNF05), errores claros (RNF16, RNF21) y mismo origen (RNF02)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_URL, ErrorApi, EVENTO_SESION_EXPIRADA, mensajesDe, pedir } from './api'

const respuesta = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } })

let almacen: Record<string, string>
let eventos: string[]
let fetchFalso: ReturnType<typeof vi.fn>

beforeEach(() => {
  almacen = {}
  eventos = []
  fetchFalso = vi.fn()
  vi.stubGlobal('fetch', fetchFalso)
  vi.stubGlobal('localStorage', { getItem: (k: string) => almacen[k] ?? null })
  vi.stubGlobal('window', { dispatchEvent: (e: Event) => eventos.push(e.type) })
})
afterEach(() => vi.unstubAllGlobals())

describe('pedir', () => {
  it('RNF02: sin VITE_API_URL pide la API al mismo origen de la página (/api)', async () => {
    expect(API_URL).toBe('')
    fetchFalso.mockResolvedValue(respuesta(200, { ok: true }))
    await pedir('/api/health')
    expect(fetchFalso.mock.calls[0]![0]).toBe('/api/health')
  })
  it('manda el token guardado y el cuerpo como JSON', async () => {
    almacen.token = 'abc'
    fetchFalso.mockResolvedValue(respuesta(201, { success: true }))
    const datos = await pedir('/api/gastos', { metodo: 'POST', cuerpo: { monto: 10 } })
    const [, opciones] = fetchFalso.mock.calls[0]!
    expect(datos).toEqual({ success: true })
    expect(opciones.method).toBe('POST')
    expect(opciones.headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer abc' })
    expect(opciones.body).toBe('{"monto":10}')
  })
  it('RNF05: las consultas automáticas llevan la cabecera de sondeo', async () => {
    fetchFalso.mockResolvedValue(respuesta(200, {}))
    await pedir('/api/notificaciones', { sondeo: true })
    expect(fetchFalso.mock.calls[0]![1].headers['x-famify-sondeo']).toBe('1')
  })
  it('RNF21: un 400 devuelve los errores por campo', async () => {
    fetchFalso.mockResolvedValue(respuesta(400, { error: 'Monto: inválido. Fecha: inválida.', errores: ['Monto: inválido.', 'Fecha: inválida.'] }))
    const err = await pedir('/api/gastos').catch((e) => e)
    expect(err).toBeInstanceOf(ErrorApi)
    expect(err.estado).toBe(400)
    expect(mensajesDe(err)).toEqual(['Monto: inválido.', 'Fecha: inválida.'])
  })
  it('RNF05: un 401 con sesión abierta avisa que la sesión expiró', async () => {
    almacen.token = 'viejo'
    fetchFalso.mockResolvedValue(respuesta(401, { error: 'Tu sesión expiró por inactividad.' }))
    await expect(pedir('/api/gastos')).rejects.toThrow('Tu sesión expiró por inactividad.')
    expect(eventos).toEqual([EVENTO_SESION_EXPIRADA])
  })
  it('un 401 sin sesión (login fallido) no dispara el aviso', async () => {
    fetchFalso.mockResolvedValue(respuesta(401, { error: 'x' }))
    await pedir('/api/auth/me').catch(() => undefined)
    expect(eventos).toEqual([])
  })
  it('RNF16: sin conexión muestra un mensaje claro', async () => {
    fetchFalso.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await pedir('/api/gastos').catch((e) => e)
    expect(err.estado).toBe(0)
    expect(err.message).toMatch(/No se pudo conectar con el servidor/)
  })
  it('RNF16: una respuesta sin JSON usa un mensaje genérico', async () => {
    fetchFalso.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }))
    await expect(pedir('/api/gastos')).rejects.toThrow('Ocurrió un problema. Intenta de nuevo.')
  })
  it('mensajesDe con un error desconocido da un mensaje genérico', () => {
    expect(mensajesDe(new Error('detalle técnico'))).toEqual(['Ocurrió un problema. Intenta de nuevo.'])
  })
})
