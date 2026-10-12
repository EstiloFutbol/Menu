export type ParsedReceiptLine = {
  rawName: string
  totalPrice: number | null
  packages: number | null
  // Solo en productos a peso de tickets digitales (por ejemplo, fruta en Mercadona).
  weightKg?: number | null
}

const ignoredLinePatterns = [
  /^(total|subtotal|iva|base imponible|efectivo|tarjeta|cambio|ahorro|descuento|gracias|factura|ticket|caja|cajero|cliente|fecha|hora|importe|entregado|visa|mastercard|n\.?c\b|aut\b)/i,
  // Desglose de IVA: "10% 63,55 6,35"
  /^\d{1,2}(?:[.,]\d+)?\s*%/,
  /^\*+$/,
  /^-+$/,
  /^=+$/,
]

// Línea del total a pagar. Lo que viene después (IVA, pago, devoluciones) no son productos.
const totalLinePattern = /^(?:total|importe total|total a pagar|a pagar)\b.*\d[.,]\s?\d{2}/i
// Segunda línea de un producto a peso: "0,612 kg 2,40 €/kg 1,47"
const weightLinePattern = /^(\d{1,3}[.,]\d{1,3})\s*kg\b.*?(\d{1,4}[.,]\s?\d{2})\s*€?$/i

export function normalizeReceiptName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function normalizeDecimalInput(value: string) {
  return value.trim().replace(/\s/g, '').replace(/,/g, '.')
}

export function parseDecimalInput(value: string) {
  const parsed = Number(normalizeDecimalInput(value))
  return Number.isFinite(parsed) ? parsed : null
}

export function parseSpanishNumber(value: string) {
  const normalized = value.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseReceiptText(text: string): ParsedReceiptLine[] {
  const seen = new Set<string>()
  const parsed: ParsedReceiptLine[] = []
  // Nombre de la línea anterior cuando no traía precio: puede ser un producto a peso.
  let pendingName: string | null = null

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+/g, ' ').trim()
    if (totalLinePattern.test(line)) break
    if (line.length < 3 || ignoredLinePatterns.some((pattern) => pattern.test(line))) continue

    const weight = line.match(weightLinePattern)
    if (weight) {
      if (pendingName) {
        const normalized = normalizeReceiptName(pendingName)
        if (normalized && !seen.has(normalized)) {
          seen.add(normalized)
          parsed.push({ rawName: pendingName, totalPrice: parseSpanishNumber(weight[2]), packages: null, weightKg: parseSpanishNumber(weight[1]) })
        }
      }
      pendingName = null
      continue
    }

    const priceMatches = [...line.matchAll(/(?:^|\s)(\d{1,4}(?:[.,]\s?\d{2}))(?:\s*€)?(?=\s|$)/g)]
    if (!priceMatches.length) {
      pendingName = /[a-záéíóúñ]{3}/i.test(line) ? line.replace(/^\d{1,2}\s+(?=\D)/, '') : null
      continue
    }
    pendingName = null

    const lastPrice = priceMatches[priceMatches.length - 1]
    const totalPrice = parseSpanishNumber(lastPrice[1])
    let rawName = cleanItemName(line.slice(0, lastPrice.index))
    rawName = rawName.replace(/^\d{5,}\s+/, '').replace(/\s+[xX]\s*$/, '').trim()

    let packages: number | null = null
    // "2 MOZZARELLA 0,90 1,80": cantidad delante y precio unitario antes del importe.
    const unitPriceMatch = rawName.match(/^(\d{1,2})\s+(\D.*?)\s+\d{1,4}[.,]\s?\d{2}$/)
    if (unitPriceMatch) {
      packages = Number(unitPriceMatch[1])
      rawName = unitPriceMatch[2].trim()
    }
    if (rawName.length < 2) continue

    const quantityMatch = rawName.match(/^(\d+(?:[.,]\d+)?)\s*[xX]\s+(.+)$/)
    if (quantityMatch) {
      const maybePackages = parseSpanishNumber(quantityMatch[1])
      if (maybePackages != null && Number.isInteger(maybePackages) && maybePackages > 0 && maybePackages <= 99) {
        packages = maybePackages
        rawName = quantityMatch[2].trim()
      }
    }

    const normalized = normalizeReceiptName(rawName)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    parsed.push({ rawName, totalPrice, packages })
  }

  return parsed
}

export function scoreReceiptText(text: string, confidence = 0) {
  const products = parseReceiptText(text)
  const hasTotal = extractReceiptTotal(text) != null
  const hasDate = extractReceiptDate(text) != null
  const store = guessStoreName(text)

  return products.length * 20
    + (hasTotal ? 15 : 0)
    + (hasDate ? 6 : 0)
    + (store ? 4 : 0)
    + Math.max(0, Math.min(100, confidence)) / 10
}

export function extractReceiptTotal(text: string) {
  const candidates = text.split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => /\btotal\b/i.test(line))
    .map((line) => {
      const matches = [...line.matchAll(/(\d{1,5}(?:[.,]\d{2}))/g)]
      return matches.length ? parseSpanishNumber(matches[matches.length - 1][1]) : null
    })
    .filter((value): value is number => value != null)

  return candidates.length ? candidates[candidates.length - 1] : null
}

// Fecha del ticket: "14/03/2026", "24/09/26" o "04.10.2026" (con punto solo si el
// año tiene cuatro cifras, para no confundirla con un precio). Si detrás viene la
// hora ("19:55"), se usa; si no, las 12:00.
export function extractReceiptDate(text: string) {
  const match = text.match(/\b(\d{1,2})(?:[\/-](\d{1,2})[\/-](\d{2,4})|\.(\d{1,2})\.(\d{4}))\b(?:\s+(\d{1,2}):(\d{2})\b)?/)
  if (!match) return null
  const [, day, slashMonth, slashYear, dotMonth, dotYear, hours, minutes] = match
  const rawYear = slashYear ?? dotYear
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)
  const date = new Date(year, Number(slashMonth ?? dotMonth) - 1, Number(day), hours ? Number(hours) : 12, minutes ? Number(minutes) : 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

// Deja los importes como "2,40" aunque el OCR los lea "2, 40" o "2.40".
export function normalizeOcrPrices(line: string) {
  return line.replace(/(\d)\s?[.,]\s?(\d{2,3})\b/g, '$1,$2')
}

// Quita la basura que el OCR suele dejar alrededor del nombre ("CEBOLLA TUBO.",
// "FUET +...", "DORITOS 140GR' *").
export function cleanItemName(value: string) {
  return value
    .replace(/^[\s|¦]+/, '')
    .replace(/[|¦]/g, 'I')
    .replace(/^[^\p{L}\d]+/u, '')
    // Lo que va detrás de un guion suelto es ruido de la columna del precio ("PIEZA —- E.").
    .replace(/\s[—–-]+(?:\s.*)?$/u, '')
    .replace(/[\s.,'"`*+>\-–—…=:;_~“”‘’»«]+$/u, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function guessStoreName(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  return lines.find((line) =>
    line.length >= 3 &&
    line.length <= 60 &&
    !/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(line) &&
    !/\d+[.,]\d{2}/.test(line) &&
    !ignoredLinePatterns.some((pattern) => pattern.test(line))
  ) ?? ''
}

// Línea de ticket con la cantidad delante, como en Mercadona y Consum:
// "1 CEBOLLA TUBO 2,40" o "2 MOZZARELLA FRESCA 0,90 1,80" (precio unitario e
// importe). Tolera la basura del OCR entre el nombre y el precio.
export function parseQuantityFirstItem(line: string): ParsedReceiptLine | null {
  const normalized = normalizeOcrPrices(line.replace(/\s+/g, ' ').trim())
  const match = normalized.match(/^(\d{1,3}) (.*?\p{L}.*?)(?: (\d{1,4},\d{2}))? [^\p{L}\d]*(\d{1,4},\d{2})\s*€?$/u)
  if (!match) return null
  const rawName = cleanItemName(match[2])
  if (rawName.length < 2) return null
  return { rawName, packages: Number(match[1]), totalPrice: parseSpanishNumber(match[4]) }
}
