import { describe, expect, it } from 'vitest'
import aldiAdaptive from './__fixtures__/aldi-ocr-adaptativo.txt?raw'
import aldiContrast from './__fixtures__/aldi-ocr-contraste.txt?raw'
import consum from './__fixtures__/consum-ocr.txt?raw'
import consumNoisy from './__fixtures__/consum-foto-ruido.txt?raw'
import { mergeReceiptReadings, nameSimilarity } from './receipt-merge'
import { extractReceiptDate } from './receipt'
import { isConsumReceipt, parseAldiReceipt, parseConsumReceipt, parseConsumRow, parseStoreReceipt } from './store-receipts'

// Los fixtures son el texto real que el OCR sacó de fotos de tickets, con sus fallos.

describe('ticket de Consum leído con OCR', () => {
  it('lee productos, total y fecha y limpia el ruido del OCR', () => {
    const receipt = parseConsumReceipt(consum)
    expect(receipt.lines.map((line) => line.rawName)).toEqual([
      'CEBOLLA SECA TUBO', 'FIL,PECHUGA CERTIFI', 'MUSLITO MAR 5006 VI', 'FUET ESPETECI70 CON',
      'MAXIBÓN NATAX4 NEST', 'SALMOREJO. 11 CONSUM', 'PIZZA PEPPERONI TAR', 'DORITOS CHILI 140GR',
    ])
    expect(receipt.lines[0]).toEqual({ rawName: 'CEBOLLA SECA TUBO', packages: 1, totalPrice: 1.99 })
    expect(receipt.total).toBe(24.42)
    expect(receipt.date).toEqual(new Date(2026, 9, 4, 19, 55))
    expect(parseStoreReceipt(consum)?.store).toBe('Consum')
  })
})

describe('ticket de Aldi leído con OCR', () => {
  it('asocia el peso y las unidades al producto siguiente y resta los descuentos', () => {
    const receipt = parseAldiReceipt(aldiContrast)
    const byName = (name: string) => receipt.lines.find((line) => line.rawName.startsWith(name))
    expect(byName('CINTA LOMO')).toEqual({ rawName: 'CINTA LOMO FILETEADA', totalPrice: 3.2, packages: null, weightKg: 0.493 })
    expect(byName('AGUACATE')).toMatchObject({ totalPrice: 4.05, packages: 3 })
    expect(byName('TORTILLAS')?.totalPrice).toBe(0.79)
    expect(byName('BERENJENA')?.totalPrice).toBe(1.12)
    expect(byName('LECHE')).toMatchObject({ totalPrice: 5.64, packages: 6 })
    expect(receipt.lines.some((line) => /€\/kg|desc/i.test(line.rawName))).toBe(false)
    expect(receipt.total).toBe(67.34)
    expect(receipt.date).toEqual(new Date(2026, 8, 24, 19, 57))
  })

  it('combina las dos lecturas para rellenar los precios que una no leyó', () => {
    const contrast = parseAldiReceipt(aldiContrast)
    const adaptive = parseAldiReceipt(aldiAdaptive)
    const merged = mergeReceiptReadings([contrast.lines, adaptive.lines], 67.34)
    const missing = (lines: { totalPrice: number | null }[]) => lines.filter((line) => line.totalPrice == null).length
    expect(missing(merged)).toBeLessThan(Math.min(missing(contrast.lines), missing(adaptive.lines)))
    const byName = (name: string) => merged.find((line) => line.rawName.startsWith(name))
    expect(byName('SURIMI')?.totalPrice).toBe(1.79)
    expect(byName('MASA PIZZA')?.totalPrice).toBe(1.35)
    expect(byName('L1 HAMBURG')?.totalPrice).toBe(4.65)
  })
})

describe('combinar lecturas', () => {
  it('elige entre precios alternativos la combinación que cuadra con el total', () => {
    const merged = mergeReceiptReadings([
      [{ rawName: 'PAN', totalPrice: 1.2, packages: null }, { rawName: 'LECHE', totalPrice: 0.95, packages: null }],
      [{ rawName: 'PAN', totalPrice: 1.7, packages: null }, { rawName: 'LECHE', totalPrice: 0.95, packages: null }],
    ], 2.65)
    expect(merged.map((line) => line.totalPrice)).toEqual([1.7, 0.95])
  })

  it('reconoce el mismo producto leído con pequeñas diferencias', () => {
    expect(nameSimilarity('MORTADELLA BOLOGNA', 'AORTADELLA BOLOGNS')).toBeGreaterThan(0.7)
    expect(nameSimilarity('PAN BLANCO', 'LECHE SEMI')).toBeLessThan(0.3)
  })
})

describe('fecha del ticket', () => {
  it('acepta fechas con puntos y años de dos cifras, con la hora si la hay', () => {
    expect(extractReceiptDate('C:4385 04.10.2026 19:55')).toEqual(new Date(2026, 9, 4, 19, 55))
    expect(extractReceiptDate('VALENCIA - 24/09/26 19:52')).toEqual(new Date(2026, 8, 24, 19, 52))
    expect(extractReceiptDate('PAN 1.29 3')).toBeNull()
  })
})

describe('líneas de Consum con ruido del OCR (fotos reales)', () => {
  it('acepta la cantidad mal leída, ruido delante y detrás del importe', () => {
    expect(parseConsumRow('$ CEBOLLA SECA TUBO          1,99')).toEqual({ rawName: 'CEBOLLA SECA TUBO', packages: 1, totalPrice: 1.99 })
    expect(parseConsumRow('| FIL,PECHUGA CERTIFI        4,70')?.totalPrice).toBe(4.7)
    expect(parseConsumRow('> 1 MAXIBÓN NATAX4 NEST- > 4,50')?.rawName).toBe('MAXIBÓN NATAX4 NEST')
    expect(parseConsumRow('5          1 bebida fria » 0,15')?.rawName).toBe('bebida fria')
    expect(parseConsumRow('L               1 CACAHUETE MIEL CONS        1,65')?.totalPrice).toBe(1.65)
    expect(parseConsumRow('1 Q.CAMEMBERT250G RUS - -   3,99   Po')?.totalPrice).toBe(3.99)
  })

  it('separa el precio unitario y corrige importes imposibles', () => {
    expect(parseConsumRow('2 NACHOS MEXICAN CON. 0,95   1,90...')).toEqual({ rawName: 'NACHOS MEXICAN CON', packages: 2, totalPrice: 1.9 })
    expect(parseConsumRow('1 TOALL FRES-LÍM C.KI 401,00 >  |')?.totalPrice).toBe(1)
    expect(parseConsumRow('1 V.BLANCO EL COTO >”   4,4511 445')?.totalPrice).toBe(4.45)
  })

  it('no confunde los datos del pago o del cliente con productos', () => {
    expect(parseConsumRow('DNI Socio-Cliente 46075****')).toBeNull()
    expect(parseConsumRow('IMPORTE A ABONAR 24,42')).toBeNull()
  })

  it('lee un ticket entero con ruido y aparta el descuento del ticket', () => {
    const receipt = parseConsumReceipt(consumNoisy)
    expect(receipt.lines).toHaveLength(15)
    expect(receipt.total).toBe(50.41)
    expect(receipt.discount).toBe(5.63)
    const sum = receipt.lines.reduce((acc, line) => acc + (line.totalPrice ?? 0), 0)
    expect(Math.round((sum - receipt.discount!) * 100) / 100).toBe(50.41)
  })

  it('reconoce Charter, la franquicia de Consum', () => {
    expect(isConsumReceipt('Supermercados charter\nLa franquicia de Consum')).toBe(true)
  })
})

describe('combinación de lecturas', () => {
  it('añade los productos que solo ha leído una de las versiones de la foto', () => {
    const first = [
      { rawName: 'QUESO CABRA RULO', totalPrice: 3.75, packages: 1 },
      { rawName: 'PAN BAGUETTE', totalPrice: 0.45, packages: 1 },
    ]
    const second = [
      { rawName: 'QUESO CABRA RULO', totalPrice: 3.75, packages: 1 },
      { rawName: 'BURRATA DOP 125 GR', totalPrice: 2.9, packages: 1 },
      { rawName: 'PAN BAGUETTE', totalPrice: 0.45, packages: 1 },
    ]
    const merged = mergeReceiptReadings([first, second], 7.1)
    expect(merged.map((line) => line.rawName)).toEqual(['QUESO CABRA RULO', 'BURRATA DOP 125 GR', 'PAN BAGUETTE'])
  })
})
