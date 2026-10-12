import { isMercadonaReceipt, parseMercadonaReceipt, type ParsedStoreReceipt } from './mercadona'
import { cleanItemName, extractReceiptDate, normalizeOcrPrices, parseQuantityFirstItem, parseSpanishNumber, type ParsedReceiptLine } from './receipt'

export type { ParsedStoreReceipt }

function toRows(text: string) {
  return text.split(/\r?\n/).map((line) => normalizeOcrPrices(line.replace(/\s+/g, ' ')).trim()).filter(Boolean)
}

function lastPrice(line: string) {
  const matches = [...line.matchAll(/(-?\d{1,4},\d{2})(?!\d)/g)]
  return matches.length ? matches[matches.length - 1] : null
}

const round2 = (value: number) => Math.round(value * 100) / 100

// Consum: "CANT ARTICULO PVP EUROS", líneas "1 CEBOLLA SECA TUBO 1,99" y el total
// en "Total factura" o "IMPORTE A ABONAR".
export function isConsumReceipt(text: string) {
  return /\bconsum\b/i.test(text) || /importe a abonar|cant\.? art[ií]culo/i.test(text)
}

export function parseConsumReceipt(text: string): ParsedStoreReceipt {
  const rows = toRows(text)
  const start = rows.findIndex((line) => /cant\.? art[ií]culo/i.test(line))
  const end = rows.findIndex((line, index) => index > start && /^(total factura|importe a abonar|total)\b/i.test(line))
  const body = rows.slice(start + 1, end === -1 ? undefined : end)
  const lines = body.map(parseQuantityFirstItem).filter((line): line is ParsedReceiptLine => line !== null)

  const totalRow = rows.find((line) => /^(total factura|importe a abonar)\b/i.test(line))
  const total = totalRow ? lastPrice(totalRow) : null
  return { store: 'Consum', date: extractReceiptDate(text), total: total ? parseSpanishNumber(total[1]) : null, lines }
}

// Aldi: el nombre y el importe van en la misma línea ("SURIMI 1,79 € 3", con el
// código de IVA al final). Los productos a peso o con varias unidades llevan una
// línea de detalle justo ANTES ("0,493 kg x 6,50 €/kg", "3 x 1,35 €"), y los
// descuentos van después ("Desc. -0,10 €") y se restan del producto anterior.
export function isAldiReceipt(text: string) {
  return /(?:^|[^\p{L}])ald[iíl](?!\p{L})/iu.test(text) || /\bA L D I\b/.test(text)
}

export function parseAldiReceipt(text: string): ParsedStoreReceipt {
  const rawRows = text.split(/\r?\n/).filter((line) => line.trim())
  const rows = rawRows.map((line) => normalizeOcrPrices(line.replace(/\s+/g, ' ')).trim())
  // La cabecera termina en el horario de apertura ("Lu-Sa: 09:00 - 21:30").
  let headerEnd = -1
  rows.slice(0, 10).forEach((line, index) => {
    if (/apertura|\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/i.test(line)) headerEnd = index
  })
  const end = rows.findIndex((line) => /^a\s*pagar\b/i.test(line))
  const bodyStart = headerEnd + 1
  const bodyEnd = end === -1 ? rows.length : end

  const lines: ParsedReceiptLine[] = []
  let detail: { weightKg?: number; packages?: number; unitPrice: number | null } | null = null

  for (let index = bodyStart; index < bodyEnd; index += 1) {
    const row = rows[index]
    const columns = rawRows[index].trim().split(/\s{3,}/)

    // Línea de precio por kilo cuyo peso el OCR no ha podido leer: es un detalle, no un producto.
    if (/€\s*\/\s*k|\/\s*k[gq9]\b/i.test(row) && !/(\d{1,3}),(\d{3})\s*k/i.test(row)) {
      const unit = row.match(/(\d{1,4},\d{2})\s*€?\s*\/\s*k/i)
      detail = { unitPrice: unit ? parseSpanishNumber(unit[1]) : null }
      continue
    }
    // Peso: "0,493 kg x 6,50 €/kg"; a veces el OCR pierde el "0" (",892 kg") o la coma ("892 kg").
    const weight = row.match(/(\d{1,3}),(\d{3})\s*k\s*[gq9]/i) ?? row.match(/^\D{0,3}?,?(\d{3})\s*k\s*[gq9]/i)
    if (weight && /x/i.test(row)) {
      const kilos = weight.length === 3 ? Number(`${weight[1]}.${weight[2]}`) : Number(`0.${weight[1]}`)
      const unit = row.match(/x\W*(\d{1,4},\d{2})/i)
      detail = { weightKg: kilos, unitPrice: unit ? parseSpanishNumber(unit[1]) : null }
      continue
    }

    const count = row.match(/^\W*(\d{1,2})\s*[xX×]\s*(\d{1,4},\d{2})/)
    if (count) {
      detail = { packages: Number(count[1]), unitPrice: parseSpanishNumber(count[2]) }
      continue
    }

    if (/^\W*desc/i.test(row)) {
      const discount = lastPrice(row)
      const previous = lines[lines.length - 1]
      if (discount && previous?.totalPrice != null && parseSpanishNumber(discount[1])) {
        previous.totalPrice = round2(previous.totalPrice - Math.abs(parseSpanishNumber(discount[1]) ?? 0))
      }
      continue
    }

    if (!/\p{L}{3}/u.test(row)) continue
    const price = lastPrice(row)
    // El OCR deja un hueco amplio entre la columna del nombre y la del importe;
    // si el importe no se ha podido leer, el nombre es lo que hay antes del hueco.
    const rawName = cleanItemName(columns.length > 1 ? columns[0] : price ? row.slice(0, price.index) : row)
    if (rawName.length < 2) continue

    let totalPrice = price ? parseSpanishNumber(price[1]) : null
    // Si el OCR no ha leído el importe, se calcula con el detalle (peso o unidades por precio).
    if (totalPrice == null && detail?.unitPrice != null) {
      totalPrice = round2((detail.weightKg ?? detail.packages ?? 1) * detail.unitPrice)
    }
    lines.push({ rawName, totalPrice, packages: detail?.packages ?? null, ...(detail?.weightKg ? { weightKg: detail.weightKg } : {}) })
    detail = null
  }

  const totalRow = end === -1 ? undefined : rows[end]
  const total = totalRow ? lastPrice(totalRow) : null
  return { store: 'Aldi', date: extractReceiptDate(text), total: total ? parseSpanishNumber(total[1]) : null, lines }
}

// Usa el lector de la tienda si se reconoce. Devuelve null si no es una tienda
// conocida o si su lector no saca ningún producto (entonces se usa el genérico).
export function parseStoreReceipt(text: string): ParsedStoreReceipt | null {
  const parsers: Array<[(text: string) => boolean, (text: string) => ParsedStoreReceipt]> = [
    [isMercadonaReceipt, parseMercadonaReceipt],
    [isAldiReceipt, parseAldiReceipt],
    [isConsumReceipt, parseConsumReceipt],
  ]
  for (const [matches, parse] of parsers) {
    if (!matches(text)) continue
    const receipt = parse(text)
    return receipt.lines.length ? receipt : null
  }
  return null
}
