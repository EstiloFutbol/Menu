import { describe, expect, it } from 'vitest'
import { isMercadonaReceipt, parseMercadonaReceipt } from './mercadona'
import { groupIntoLines } from './receipt-pdf'

// Fragmento del texto de un ticket digital de Mercadona, tal como sale del PDF.
const ticket = `MERCADONA, S.A. A-46103834
14/03/2026 13:14 OP: 119340
FACTURA SIMPLIFICADA: 2475-013-974135
Descripción P. Unit Importe
1 CEBOLLA TUBO 2,40
1 ZANAHORIA 500 G 0,85
2 MOZZARELLA FRESCA 0,90 1,80
1 6 HUEVOS CAMPEROS 2,10
1 BERENJENA
0,612 kg 2,40 €/kg 1,47
TOTAL (€) 8,62
TARJETA BANCARIA 8,62
IVA BASE IMPONIBLE (€) CUOTA (€)
4% 17,54 0,70
Importe: 8,62 €`

describe('ticket digital de Mercadona', () => {
  it('reconoce el ticket', () => {
    expect(isMercadonaReceipt(ticket)).toBe(true)
    expect(isMercadonaReceipt('CONSUM S.COOP')).toBe(false)
  })

  it('lee productos, unidades y productos a peso, sin IVA ni pago', () => {
    const result = parseMercadonaReceipt(ticket)
    expect(result.lines).toEqual([
      { rawName: 'CEBOLLA TUBO', packages: 1, totalPrice: 2.4 },
      { rawName: 'ZANAHORIA 500 G', packages: 1, totalPrice: 0.85 },
      { rawName: 'MOZZARELLA FRESCA', packages: 2, totalPrice: 1.8 },
      { rawName: '6 HUEVOS CAMPEROS', packages: 1, totalPrice: 2.1 },
      { rawName: 'BERENJENA', packages: 1, totalPrice: 1.47, weightKg: 0.612 },
    ])
    expect(result.total).toBe(8.62)
    expect(result.date).toEqual(new Date(2026, 2, 14, 13, 14))
  })

  it('tolera los fallos típicos del OCR en una foto', () => {
    const result = parseMercadonaReceipt('MERCADONA S.A.\nDescripcion P. Unit Importe\n1 CEBOLLA TUBO 2, 40\n2 ARROZ BASMATI 1.15 2.30\n1 BERENJENA\n0,612 kg 2,40 E/kg 1,47\nTOTAL (€) 6,17')
    expect(result.lines).toEqual([
      { rawName: 'CEBOLLA TUBO', packages: 1, totalPrice: 2.4 },
      { rawName: 'ARROZ BASMATI', packages: 2, totalPrice: 2.3 },
      { rawName: 'BERENJENA', packages: 1, totalPrice: 1.47, weightKg: 0.612 },
    ])
    expect(result.total).toBe(6.17)
  })

  it('reconstruye las líneas del PDF a partir de las posiciones del texto', () => {
    expect(groupIntoLines([
      { text: '2,40', x: 200, y: 500 },
      { text: '1 CEBOLLA TUBO', x: 10, y: 500.5 },
      { text: 'TOTAL (€)', x: 100, y: 480 },
      { text: 'Descripción', x: 10, y: 520 },
    ])).toEqual(['Descripción', '1 CEBOLLA TUBO 2,40', 'TOTAL (€)'])
  })
})
