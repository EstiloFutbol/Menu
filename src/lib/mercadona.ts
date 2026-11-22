import { cleanItemName, extractReceiptDate, misreadOne, normalizeOcrPrices, parseNoisyQuantityItem, parseQuantityFirstItem, parseSpanishNumber, type ParsedReceiptLine } from './receipt'

export type ParsedStoreReceipt = {
  store: string
  date: Date | null
  total: number | null
  // Descuentos del ticket que no van ligados a un producto (p. ej. "Descuento mensual" de Consum).
  discount?: number
  lines: ParsedReceiptLine[]
}

const price = String.raw`\d{1,4},\d{2}`
// Segunda línea de un producto a peso: "0,612 kg 2,40 €/kg 1,47". En fotos se
// tolera ruido alrededor y que el OCR lea la "g" como "q" o "9".
const weightPattern = new RegExp(String.raw`(\d{1,3},\d{1,3}) ?k[gq9]\b.*?(${price}) ?(?:€|e)? ?/ ?k[gq9]\b\D*?(${price})\D{0,4}$`, 'i')
// Nombre de producto con la cantidad delante y sin importe legible:
// "1 PEPINO HOLANDES En" o "1 BERENJENA" (producto a peso).
const pricelessPattern = new RegExp(String.raw`^[^\p{L}\d]{0,4}(?:(\d{1,2})|${misreadOne})\s+(\p{L}.*)$`, 'u')

export function isMercadonaReceipt(text: string) {
  return /\bMERCADONA\b/i.test(text)
}

// Línea de producto cuyo importe no se ha podido leer. Mercadona escribe los
// nombres en mayúsculas, así que lo que va detrás en minúsculas, o sin letras,
// es ruido del OCR ("En", "7 3%", "1,9%").
function parsePricelessItem(row: string): ParsedReceiptLine | null {
  const match = row.match(pricelessPattern)
  if (!match) return null
  const words = match[2].split(' ')
  while (words.length && (/\p{Ll}/u.test(words[words.length - 1]) || !/\p{L}/u.test(words[words.length - 1]) || words[words.length - 1].length === 1)) words.pop()
  const rawName = cleanItemName(words.join(' '))
  if (/\p{Ll}/u.test(rawName) || !/\p{Lu}{3}/u.test(rawName)) return null
  return { rawName, packages: match[1] ? Number(match[1]) : 1, totalPrice: null }
}

// "16 HUEVOS CAMPEROS 1,95" es "1 6 HUEVOS CAMPEROS" sin el espacio: si hubiera
// 16 unidades, el ticket llevaría también el precio por unidad.
// La cantidad leída dos veces queda pegada delante del nombre («1 1 CEBO TAPAS»,
// «| QUESO UNTAR LIGHT»). Mercadona no empieza ningún nombre por «1 » y una palabra.
function stripRepeatedQuantity(item: ParsedReceiptLine): ParsedReceiptLine {
  const rawName = item.rawName.replace(/^(?:[1Il|!] )+(?=\p{L}{2})/u, '')
  return rawName === item.rawName ? item : { ...item, rawName }
}

function fixGluedQuantity(item: ParsedReceiptLine, row: string): ParsedReceiptLine {
  const glued = row.match(/^[^\p{L}\d]{0,4}1(\d{1,2}) /u)
  if (!glued || item.packages !== Number(`1${glued[1]}`) || (row.match(/\d{1,4},\d{2}/g) ?? []).length > 1) return item
  return { ...item, packages: 1, rawName: `${glued[1]} ${item.rawName}` }
}

// Total del ticket. Una foto puede leer mal la línea del TOTAL, así que se
// reúnen todas las pistas (TOTAL, pago con tarjeta, "Importe: 26,80 €" y la
// suma de base imponible y cuota del IVA) y se queda la que más se repite.
function findTotal(rows: string[], start: number) {
  const ivaIndex = rows.findIndex((line, index) => index > start && /base imponible|cuota/i.test(line))
  const beforeIva = (index: number) => ivaIndex === -1 || index < ivaIndex
  const prices = (line: string) => [...line.matchAll(/(\d{1,4},\d{2})(?![\d,])/g)].map((match) => parseSpanishNumber(match[1])!)
  const candidates: number[] = []
  rows.forEach((line, index) => {
    if (index <= start) return
    const found = prices(line)
    if (!found.length) return
    if (/^\W{0,3}total\b/i.test(line)) {
      if (beforeIva(index)) candidates.push(found[found.length - 1])
      // "TOTAL 25,02 1,78" del desglose de IVA: base más cuota.
      else if (found.length >= 2) candidates.push(Math.round((found[found.length - 2] + found[found.length - 1]) * 100) / 100)
    } else if (/^\W{0,3}tarjeta\b/i.test(line) && beforeIva(index)) {
      candidates.push(found[found.length - 1])
    } else if (/[a-z]porte\s*[:;]/i.test(line)) {
      candidates.push(found[0])
    }
  })
  let best: number | null = null
  let bestCount = 0
  for (const candidate of candidates) {
    const count = candidates.filter((value) => value === candidate).length
    if (count > bestCount) { best = candidate; bestCount = count }
  }
  return best
}

// Lee el ticket de Mercadona: el PDF que llega por correo o la foto del ticket
// en papel. Solo se miran las líneas entre la cabecera "Descripción" y el
// "TOTAL", así que el desglose de IVA y los datos del pago no se confunden con
// productos.
export function parseMercadonaReceipt(text: string): ParsedStoreReceipt {
  // En fotos el OCR a veces lee "2, 40" o "2.40": se deja todo como "2,40".
  const rows = text.split(/\r?\n/)
    .map((line) => normalizeOcrPrices(line.replace(/\s+/g, ' ')).trim())
    .filter(Boolean)
  // La cabecera de columnas sale a menudo mal leída ("Descripció P. UIt", "AP Unit Imp. (€)").
  let start = rows.findIndex((line) => /descripci|\bunit\b|\bimp(?:orte)?\.?\s*\(/i.test(line))
  if (start === -1) start = rows.findIndex((line) => /factura simplificada/i.test(line))
  const end = rows.findIndex((line, index) => index > start && (/^\W{0,3}total\b/i.test(line) || /\btarjeta\b|\befectivo\b|base imponible/i.test(line)))
  const body = rows.slice(start + 1, end === -1 ? undefined : end)

  const lines: ParsedReceiptLine[] = []
  for (const row of body) {
    // Peso e importe de un producto a peso: completan la línea anterior ("1 BERENJENA").
    const weight = row.match(weightPattern)
    if (weight) {
      const previous = lines[lines.length - 1]
      if (previous && previous.totalPrice == null && previous.weightKg == null) {
        previous.weightKg = parseSpanishNumber(weight[1])
        previous.totalPrice = parseSpanishNumber(weight[3])
      }
      continue
    }
    const item = parseQuantityFirstItem(row) ?? parseNoisyQuantityItem(row)
    if (item) {
      lines.push(stripRepeatedQuantity(fixGluedQuantity(item, row)))
      continue
    }
    // Sin importe legible se apunta igual: lo completa otra lectura de la foto o, si
    // no, la persona (la app avisa de cuánto falta para llegar al total).
    const named = parsePricelessItem(row)
    if (named) lines.push(stripRepeatedQuantity(fixGluedQuantity(named, row)))
  }

  return {
    store: 'Mercadona',
    date: extractReceiptDate(text),
    total: findTotal(rows, start),
    lines,
  }
}
