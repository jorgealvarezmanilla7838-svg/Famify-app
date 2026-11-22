// RF029_ / RF031_ Barras de progreso (gráficas) y RNF22_ accesibilidad; RNF31_ aviso de privacidad
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Barra, Encabezado } from './Comunes'
import { AvisoPrivacidad } from './AvisoPrivacidad'

describe('Barra (RF029, RF031, RNF22)', () => {
  it('calcula el porcentaje y lo expone como progressbar accesible', () => {
    const html = renderToStaticMarkup(<Barra etiqueta="Alimentos" detalle="$750.00" valor={750} maximo={1000} estado="cerca" />)
    expect(html).toContain('role="progressbar"')
    expect(html).toContain('aria-label="Alimentos"')
    expect(html).toContain('aria-valuenow="75"')
    expect(html).toContain('width:75%')
    expect(html).toContain('modulo-barra-relleno--cerca')
  })
  it('no pasa de 100 % aunque se exceda el límite', () => {
    const html = renderToStaticMarkup(<Barra etiqueta="Ocio" detalle="" valor={1500} maximo={1000} estado="excedido" />)
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain('width:100%')
  })
  it('con máximo 0 muestra 0 % (sin dividir entre cero)', () => {
    const html = renderToStaticMarkup(<Barra etiqueta="Meta" detalle="" valor={10} maximo={0} />)
    expect(html).toContain('aria-valuenow="0"')
    expect(html).toContain('modulo-barra-relleno--ok')
  })
})

describe('Encabezado (RNF19, RNF22)', () => {
  it('usa la misma estructura en todos los módulos y oculta el ícono a lectores de pantalla', () => {
    const html = renderToStaticMarkup(<Encabezado titulo="Gastos" descripcion="Registra tus gastos" icono="💸" />)
    expect(html).toContain('<h3>Gastos</h3>')
    expect(html).toContain('aria-hidden="true"')
  })
})

describe('Aviso de privacidad (RNF31, RNF07, RNF32, RNF20)', () => {
  const html = renderToStaticMarkup(<AvisoPrivacidad />)
  it('menciona la ley y los derechos ARCO, en español', () => {
    expect(html).toContain('Ley Federal de Protección de Datos Personales en Posesión de los Particulares')
    expect(html).toContain('Derechos ARCO')
  })
  it('aclara que no se guardan números de tarjeta y cómo darse de baja', () => {
    expect(html).toContain('no guarda números de tarjeta')
    expect(html).toContain('Darme de baja')
  })
})
