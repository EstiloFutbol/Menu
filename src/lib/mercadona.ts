import { extractReceiptDate, normalizeOcrPrices, parseQuantityFirstItem, parseSpanishNumber, type ParsedReceiptLine } from './receipt'

export type ParsedStoreReceipt = {
  store: string
  date: Date | null
  total: number | null
  lines: ParsedReceiptLine[]
}

const price = String.raw`\d{1,4},\d{2}`
// "1 BERENJENA" seguido en la línea siguiente de "0,612 kg 2,40 €/kg 1,47"
const weighedNamePattern = /^(\d{1,3}) (\D.*)$/
const weightPattern = new RegExp(String.raw`^(\d{1,3},\d{1,3}) ?kg (${price}) ?(?:€|e)? ?/ ?kg (${price})$`, 'i')

export function isMercadonaReceipt(text: string) {
  return /\bMERCADONA\b/i.test(text)
}

// Lee el ticket digital de Mercadona (el PDF que llega por correo). Solo se
// miran las líneas entre la cabecera "Descripción" y el "TOTAL", así que el
// desglose de IVA y los datos del pago no se confunden con productos.
export function parseMercadonaReceipt(text: string): ParsedStoreReceipt {
  // En fotos el OCR a veces lee "2, 40" o "2.40": se deja todo como "2,40".
  const rows = text.split(/\r?\n/)
    .map((line) => normalizeOcrPrices(line.replace(/\s+/g, ' ')).trim())
    .filter(Boolean)
  const start = rows.findIndex((line) => /^descripci[oó]n\b/i.test(line))
  const end = rows.findIndex((line, index) => index > start && /^total\b/i.test(line))
  const body = rows.slice(start + 1, end === -1 ? undefined : end)

  const lines: ParsedReceiptLine[] = []
  for (let index = 0; index < body.length; index += 1) {
    const row = body[index]
    const item = parseQuantityFirstItem(row)
    if (item) {
      lines.push(item)
      continue
    }

    const weighed = row.match(weighedNamePattern)
    const weight = body[index + 1]?.match(weightPattern)
    if (weighed && weight) {
      lines.push({
        rawName: weighed[2].trim(),
        packages: Number(weighed[1]),
        totalPrice: parseSpanishNumber(weight[3]),
        weightKg: parseSpanishNumber(weight[1]),
      })
      index += 1
    }
  }

  const totalRow = end === -1 ? undefined : rows[end]
  const totalMatch = totalRow?.match(new RegExp(`(${price})$`))

  return {
    store: 'Mercadona',
    date: extractReceiptDate(text),
    total: totalMatch ? parseSpanishNumber(totalMatch[1]) : null,
    lines,
  }
}
