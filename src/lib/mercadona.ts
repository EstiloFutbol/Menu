import { extractReceiptDate, parseSpanishNumber, type ParsedReceiptLine } from './receipt'

export type ParsedStoreReceipt = {
  store: string
  date: Date | null
  total: number | null
  lines: ParsedReceiptLine[]
}

const price = String.raw`\d{1,4},\d{2}`
// "1 CEBOLLA TUBO 2,40" o "2 MOZZARELLA FRESCA 0,90 1,80"
const itemPattern = new RegExp(String.raw`^(\d{1,3}) (.+?)(?: (${price}))? (${price})$`)
// "1 BERENJENA" seguido en la línea siguiente de "0,612 kg 2,40 €/kg 1,47"
const weighedNamePattern = /^(\d{1,3}) (\D.*)$/
const weightPattern = new RegExp(String.raw`^(\d{1,3},\d{1,3}) kg (${price}) €/kg (${price})$`)

// La fecha con su hora ("14/03/2026 13:14"); si no hay hora, la de extractReceiptDate.
function extractReceiptDateTime(text: string) {
  const match = text.match(/\b(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})\b/)
  if (!match) return extractReceiptDate(text)
  const [, day, month, year, hours, minutes] = match.map(Number)
  const date = new Date(year, month - 1, day, hours, minutes)
  return Number.isNaN(date.getTime()) ? extractReceiptDate(text) : date
}

export function isMercadonaReceipt(text: string) {
  return /\bMERCADONA\b/i.test(text)
}

// Lee el ticket digital de Mercadona (el PDF que llega por correo). Solo se
// miran las líneas entre la cabecera "Descripción" y el "TOTAL", así que el
// desglose de IVA y los datos del pago no se confunden con productos.
export function parseMercadonaReceipt(text: string): ParsedStoreReceipt {
  const rows = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const start = rows.findIndex((line) => /^descripci[oó]n\b/i.test(line))
  const end = rows.findIndex((line, index) => index > start && /^total\b/i.test(line))
  const body = rows.slice(start + 1, end === -1 ? undefined : end)

  const lines: ParsedReceiptLine[] = []
  for (let index = 0; index < body.length; index += 1) {
    const row = body[index]
    const item = row.match(itemPattern)
    if (item) {
      lines.push({ rawName: item[2].trim(), packages: Number(item[1]), totalPrice: parseSpanishNumber(item[4]) })
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
    date: extractReceiptDateTime(text),
    total: totalMatch ? parseSpanishNumber(totalMatch[1]) : null,
    lines,
  }
}
