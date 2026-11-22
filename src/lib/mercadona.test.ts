import { describe, expect, it } from 'vitest'
import first from './__fixtures__/mercadona-foto-1.txt?raw'
import second from './__fixtures__/mercadona-foto-2.txt?raw'
import { isMercadonaReceipt, parseMercadonaReceipt } from './mercadona'
import { groupIntoLines } from './receipt-pdf'
import { readReceiptTexts } from './receipt-read'

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

  it('quita la cantidad repetida delante del nombre', () => {
    const result = parseMercadonaReceipt('MERCADONA S.A.\nDescripción P. Unit Importe\n1 1 CEBO TAPAS 6,79\n1 | QUESO UNTAR LIGHT 1,40\n1 6 HUEVOS CAMPEROS 1,95\nTOTAL (€) 10,14')
    expect(result.lines.map((line) => line.rawName)).toEqual(['CEBO TAPAS', 'QUESO UNTAR LIGHT', '6 HUEVOS CAMPEROS'])
  })

  describe('foto de un ticket en papel', () => {
    // Dos lecturas reales (anonimizadas) de la misma foto, con la cabecera, el TOTAL
    // y varios importes mal leídos.
    it('apunta el producto aunque no se lea su importe', () => {
      const result = parseMercadonaReceipt(first)
      expect(result.lines[0]).toEqual({ rawName: 'PEPINO HOLANDES', packages: 1, totalPrice: null })
      expect(result.lines).toHaveLength(10)
    })

    it('lee "16 HUEVOS" como 1 paquete de "6 HUEVOS" y tolera ruido tras el importe', () => {
      expect(parseMercadonaReceipt(first).lines[9]).toEqual({ rawName: '6 HUEVOS CAMPEROS', packages: 1, totalPrice: 1.95 })
      const lines = parseMercadonaReceipt(second).lines
      expect(lines.find((line) => line.rawName.includes('HUEVOS'))).toMatchObject({ rawName: '6 HUEVOS CAMPEROS', packages: 1 })
      expect(lines.find((line) => line.rawName.startsWith('ENS.IV'))?.totalPrice).toBe(0.85)
    })

    it('saca el total del importe pagado y del IVA si la línea del TOTAL está mal leída', () => {
      expect(parseMercadonaReceipt(first).total).toBe(26.8)
      expect(parseMercadonaReceipt(second).total).toBe(26.8)
      expect(parseMercadonaReceipt(first).date).toEqual(new Date(2026, 10, 17, 10, 13))
    })

    it('combina las dos lecturas sin perder productos', () => {
      const reading = readReceiptTexts([first, second])
      expect(reading.total).toBe(26.8)
      expect(reading.lines.map((line) => line.rawName)).toEqual([
        'PEPINO HOLANDES', 'UVA BLANCA S/SEM', 'ENS.IV ESTACTONES', 'CEBO TAPAS', 'BAGUETTE',
        'QUESO UNTAR LIGHT', 'BURRATA', 'WAKAME', 'LOMO SALMÓN NORUEGO', '6 HUEVOS CAMPEROS',
      ])
    })
  })
})
