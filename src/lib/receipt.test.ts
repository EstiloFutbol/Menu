import { describe, expect, it } from 'vitest'
import { extractReceiptDate, extractReceiptTotal, normalizeDecimalInput, normalizeReceiptName, parseDecimalInput, parseReceiptText, scoreReceiptText } from './receipt'

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

  it('ignora lo que va después del total y el desglose de IVA', () => {
    const result = parseReceiptText('PAN 1,00\nLECHE 2,00\nTOTAL (€) 3,00\nTARJETA BANCARIA 3,00\n10% 2,73 0,27\nImporte: 3,00 €\nDEVOLUCION 1,00')
    expect(result.map((line) => line.rawName)).toEqual(['PAN', 'LECHE'])
  })

  it('separa unidades y precio unitario, y lee productos a peso en dos líneas', () => {
    const result = parseReceiptText('2 MOZZARELLA FRESCA 0,90 1,80\n1 BERENJENA\n0,612 kg 2,40 €/kg 1,47\nTOTAL 3,27')
    expect(result).toEqual([
      { rawName: 'MOZZARELLA FRESCA', totalPrice: 1.8, packages: 2 },
      { rawName: 'BERENJENA', totalPrice: 1.47, packages: null, weightKg: 0.612 },
    ])
  })

  it('prefiere una lectura con más productos válidos', () => {
    const poor = 'SUPERMERCADO\nTOTAL 5,00'
    const good = 'SUPERMERCADO\nPAN 1,00\nLECHE 2,00\nTOTAL 3,00'
    expect(scoreReceiptText(good, 70)).toBeGreaterThan(scoreReceiptText(poor, 95))
  })

  it('normaliza comas decimales antes de guardar', () => {
    expect(normalizeDecimalInput(' 2,50 ')).toBe('2.50')
    expect(parseDecimalInput('1,25')).toBe(1.25)
    expect(parseDecimalInput('3.75')).toBe(3.75)
  })

  it('extrae total y fecha para precargar la revision', () => {
    const text = 'SUPERMERCADO\n18/09/2026 14:10\nTOTAL EUR 24,37'
    expect(extractReceiptTotal(text)).toBe(24.37)
    expect(extractReceiptDate(text)?.getFullYear()).toBe(2026)
  })
})
