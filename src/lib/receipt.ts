export type ParsedReceiptLine = {
  rawName: string
  totalPrice: number | null
  packages: number | null
}

const ignoredLinePatterns = [
  /^(total|subtotal|iva|base imponible|efectivo|tarjeta|cambio|ahorro|descuento|gracias|factura|ticket|caja|cajero|cliente|fecha|hora)\b/i,
  /^\*+$/,
  /^-+$/,
  /^=+$/,
]

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

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+/g, ' ').trim()
    if (line.length < 3 || ignoredLinePatterns.some((pattern) => pattern.test(line))) continue

    const priceMatches = [...line.matchAll(/(?:^|\s)(\d{1,4}(?:[.,]\s?\d{2}))(?:\s*€)?(?=\s|$)/g)]
    if (!priceMatches.length) continue

    const lastPrice = priceMatches[priceMatches.length - 1]
    const totalPrice = parseSpanishNumber(lastPrice[1])
    let rawName = line.slice(0, lastPrice.index).trim()
      .replace(/[|¦]/g, 'I')
      .replace(/\s{2,}/g, ' ')
    rawName = rawName.replace(/^\d{5,}\s+/, '').replace(/\s+[xX]\s*$/, '').trim()
    if (rawName.length < 2) continue

    let packages: number | null = null
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

export function extractReceiptDate(text: string) {
  const match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/)
  if (!match) return null
  const [, day, month, rawYear] = match
  const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear)
  const date = new Date(year, Number(month) - 1, Number(day), 12, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
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
