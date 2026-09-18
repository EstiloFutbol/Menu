import { describe, expect, it } from 'vitest'
import { extractReceiptDate, extractReceiptTotal, normalizeReceiptName, parseReceiptText, scoreReceiptText } from './receipt'

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

  it('tolera decimales separados por OCR', () => {
    const result = parseReceiptText('PAN INTEGRAL 1, 89\nLECHE 0,95')
    expect(result).toEqual([
      { rawName: 'PAN INTEGRAL', totalPrice: 1.89, packages: null },
      { rawName: 'LECHE', totalPrice: 0.95, packages: null },
    ])
  })

  it('prefiere una lectura con más productos válidos', () => {
    const poor = 'SUPERMERCADO\nTOTAL 5,00'
    const good = 'SUPERMERCADO\nPAN 1,00\nLECHE 2,00\nTOTAL 3,00'
    expect(scoreReceiptText(good, 70)).toBeGreaterThan(scoreReceiptText(poor, 95))
  })

  it('extrae total y fecha para precargar la revision', () => {
    const text = 'SUPERMERCADO\n18/09/2026 14:10\nTOTAL EUR 24,37'
    expect(extractReceiptTotal(text)).toBe(24.37)
    expect(extractReceiptDate(text)?.getFullYear()).toBe(2026)
  })
})
