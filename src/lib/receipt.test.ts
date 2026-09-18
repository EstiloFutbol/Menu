import { describe, expect, it } from 'vitest'
import { extractReceiptDate, extractReceiptTotal, normalizeReceiptName, parseReceiptText } from './receipt'

describe('ticket OCR helpers', () => {
  it('normaliza conceptos para reutilizar traducciones', () => {
    expect(normalizeReceiptName('PECH. PAVO  Finas-Hierbas')).toBe('pech pavo finas hierbas')
  })

  it('extrae lineas de producto y descarta totales', () => {
    const result = parseReceiptText('MERCADO\n2 X YOGUR NATURAL 3,18\nTOMATE CHERRY 2,49\nTOTAL 5,67\nTARJETA 5,67')
    expect(result).toEqual([
      { rawName: 'YOGUR NATURAL', totalPrice: 3.18, packages: 2 },
      { rawName: 'TOMATE CHERRY', totalPrice: 2.49, packages: null },
    ])
  })

  it('extrae total y fecha para precargar la revision', () => {
    const text = 'SUPERMERCADO\n18/09/2026 14:10\nTOTAL EUR 24,37'
    expect(extractReceiptTotal(text)).toBe(24.37)
    expect(extractReceiptDate(text)?.getFullYear()).toBe(2026)
  })
})
