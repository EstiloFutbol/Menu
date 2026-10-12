import { normalizeReceiptName, type ParsedReceiptLine } from './receipt'

// Parecido entre dos nombres (coeficiente de Dice sobre pares de letras): 1 si son
// iguales, 0 si no comparten nada. Sirve para emparejar el mismo producto leído
// con pequeñas diferencias en dos versiones de la foto.
export function nameSimilarity(a: string, b: string) {
  const pairs = (value: string) => {
    const text = normalizeReceiptName(value).replace(/ /g, '')
    const result: string[] = []
    for (let index = 0; index < text.length - 1; index += 1) result.push(text.slice(index, index + 2))
    return result
  }
  const left = pairs(a)
  const right = pairs(b)
  if (!left.length || !right.length) return normalizeReceiptName(a) === normalizeReceiptName(b) ? 1 : 0
  const remaining = [...right]
  let shared = 0
  for (const pair of left) {
    const index = remaining.indexOf(pair)
    if (index !== -1) { shared += 1; remaining.splice(index, 1) }
  }
  return (2 * shared) / (left.length + right.length)
}

const cents = (value: number) => Math.round(value * 100)

// Combina varias lecturas del mismo ticket (una por cada versión de la imagen).
// Se parte de la lectura con más precios y, para cada producto, se reúnen los
// precios que han dado las demás. Si falta el precio, se toma el de otra lectura;
// si la suma no cuadra con el total del ticket, se prueba con los precios
// alternativos hasta dar con una combinación que sí cuadre.
export function mergeReceiptReadings(readings: ParsedReceiptLine[][], total: number | null): ParsedReceiptLine[] {
  const usable = readings.filter((reading) => reading.length)
  if (!usable.length) return []
  const pricedCount = (reading: ParsedReceiptLine[]) => reading.filter((line) => line.totalPrice != null).length
  const base = [...usable].sort((a, b) => pricedCount(b) - pricedCount(a) || b.length - a.length)[0]
  const others = usable.filter((reading) => reading !== base)

  const candidates: number[][] = base.map((line) => (line.totalPrice != null ? [line.totalPrice] : []))
  const merged = base.map((line) => ({ ...line }))

  for (const other of others) {
    const used = new Set<number>()
    base.forEach((line, index) => {
      let best = -1
      let bestScore = 0.55
      other.forEach((candidate, candidateIndex) => {
        if (used.has(candidateIndex)) return
        // Se prefiere el producto en una posición parecida, por si hay nombres repetidos.
        const score = nameSimilarity(line.rawName, candidate.rawName) - Math.abs(candidateIndex - index) * 0.01
        if (score > bestScore) { bestScore = score; best = candidateIndex }
      })
      if (best === -1) return
      used.add(best)
      const match = other[best]
      if (match.totalPrice != null && !candidates[index].some((price) => cents(price) === cents(match.totalPrice!))) {
        candidates[index].push(match.totalPrice)
      }
      if (merged[index].weightKg == null && match.weightKg != null) merged[index].weightKg = match.weightKg
      if (merged[index].packages == null && match.packages != null) merged[index].packages = match.packages
    })
  }

  merged.forEach((line, index) => {
    if (line.totalPrice == null && candidates[index].length) line.totalPrice = candidates[index][0]
  })

  if (total == null) return merged
  const sum = () => merged.reduce((acc, line) => acc + cents(line.totalPrice ?? 0), 0)
  const target = cents(total)
  if (sum() === target) return merged

  // Productos con más de un precio posible: se prueban las combinaciones (como
  // mucho 12 productos, 4096 combinaciones) y se usa la primera que cuadre.
  const doubtful = candidates.map((options, index) => ({ index, options })).filter((item) => item.options.length > 1).slice(0, 12)
  if (!doubtful.length) return merged
  const fixed = sum() - doubtful.reduce((acc, item) => acc + cents(merged[item.index].totalPrice ?? 0), 0)

  const choice: number[] = []
  const search = (position: number, running: number): boolean => {
    if (position === doubtful.length) return running === target
    for (const option of doubtful[position].options) {
      choice[position] = option
      if (search(position + 1, running + cents(option))) return true
    }
    return false
  }
  if (search(0, fixed)) doubtful.forEach((item, position) => { merged[item.index].totalPrice = choice[position] })
  return merged
}
