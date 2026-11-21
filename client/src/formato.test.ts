// RNF23_ Montos en MXN con separador de miles y dos decimales, fechas DD/MM/AAAA
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fechaLocal, fechaVisible, finMes, hoy, inicioAnio, inicioMes, inicioSemana, moneda } from './formato'

describe('moneda (RNF23)', () => {
  it('muestra pesos con separador de miles y dos decimales', () => {
    expect(moneda(1234567.5)).toBe('$1,234,567.50')
    expect(moneda('350')).toBe('$350.00')
    expect(moneda(0)).toBe('$0.00')
  })
  it('redondea a dos decimales y muestra negativos', () => {
    expect(moneda(10.005)).toMatch(/^\$10\.0[01]$/)
    expect(moneda(-2500.75)).toBe('-$2,500.75')
  })
})

describe('fechaVisible (RNF23)', () => {
  it('convierte AAAA-MM-DD en DD/MM/AAAA', () => {
    expect(fechaVisible('2026-11-21')).toBe('21/11/2026')
    expect(fechaVisible('2026-01-05T10:00:00Z')).toBe('05/01/2026')
  })
  it('devuelve vacío si no hay fecha', () => {
    expect(fechaVisible(null)).toBe('')
    expect(fechaVisible(undefined)).toBe('')
    expect(fechaVisible('')).toBe('')
  })
})

describe('rangos de fechas para consultas por periodo (RF012, RF017)', () => {
  afterEach(() => vi.useRealTimers())

  it('fechaLocal usa la fecha local con ceros', () => {
    expect(fechaLocal(new Date(2026, 1, 3))).toBe('2026-02-03')
  })
  it('calcula hoy, inicio de mes, de año y fin de mes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 21, 12))
    expect(hoy()).toBe('2026-11-21')
    expect(inicioMes()).toBe('2026-11-01')
    expect(inicioAnio()).toBe('2026-01-01')
    expect(finMes()).toBe('2026-11-30')
  })
  it('la semana empieza en lunes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 21, 12)) // sábado
    expect(inicioSemana()).toBe('2026-11-16')
    vi.setSystemTime(new Date(2026, 10, 22, 12)) // domingo
    expect(inicioSemana()).toBe('2026-11-16')
    vi.setSystemTime(new Date(2026, 10, 23, 12)) // lunes
    expect(inicioSemana()).toBe('2026-11-23')
  })
  it('fin de mes en febrero bisiesto', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2028, 1, 10, 12))
    expect(finMes()).toBe('2028-02-29')
  })
})
