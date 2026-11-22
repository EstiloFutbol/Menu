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
// precios que han dado las demás con cuántas lecturas los dan (votos). Se queda
// el precio más votado. Si la suma no cuadra con el total del ticket, el total
// solo sirve para desempatar: se prueba entre los precios empatados en votos,
// nunca se impone uno que dan menos lecturas (un precio mal leído en dos líneas
// puede compensarse con otro y cuadrar por casualidad).
export function mergeReceiptReadings(readings: ParsedReceiptLine[][], total: number | null): ParsedReceiptLine[] {
  const usable = readings.filter((reading) => reading.length)
  if (!usable.length) return []
  const pricedCount = (reading: ParsedReceiptLine[]) => reading.filter((line) => line.totalPrice != null).length
  const base = [...usable].sort((a, b) => pricedCount(b) - pricedCount(a) || b.length - a.length)[0]
  const others = usable.filter((reading) => reading !== base)

  // Precios posibles de cada línea (en orden de aparición) y cuántas lecturas dan cada uno.
  const candidates: number[][] = base.map((line) => (line.totalPrice != null ? [line.totalPrice] : []))
  const votes: Map<number, number>[] = base.map((line) => new Map(line.totalPrice != null ? [[cents(line.totalPrice), 1]] : []))
  const vote = (index: number, price: number) => {
    if (!candidates[index].some((existing) => cents(existing) === cents(price))) candidates[index].push(price)
    votes[index].set(cents(price), (votes[index].get(cents(price)) ?? 0) + 1)
  }
  const merged = base.map((line) => ({ ...line }))

  for (const other of others) {
    const used = new Set<number>()
    // Posición en `merged` de cada línea de esta lectura que casa con la base.
    const placed = new Map<number, number>()
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
      placed.set(best, index)
      const match = other[best]
      if (match.totalPrice != null) vote(index, match.totalPrice)
      if (merged[index].weightKg == null && match.weightKg != null) merged[index].weightKg = match.weightKg
      if (merged[index].packages == null && match.packages != null) merged[index].packages = match.packages
    })

    // Productos que esta lectura sí ha visto y la base no: se insertan detrás del
    // último producto anterior que ambas comparten, para conservar el orden.
    const missing = other
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => !used.has(index) && line.totalPrice != null &&
        merged.every((existing) => nameSimilarity(existing.rawName, line.rawName) < 0.45))
    for (const { line, index } of missing.reverse()) {
      let anchor = -1
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        if (placed.has(previous)) { anchor = placed.get(previous)!; break }
      }
      merged.splice(anchor + 1, 0, { ...line })
      candidates.splice(anchor + 1, 0, [line.totalPrice!])
      votes.splice(anchor + 1, 0, new Map([[cents(line.totalPrice!), 1]]))
      placed.forEach((position, key) => { if (position > anchor) placed.set(key, position + 1) })
    }
  }

  // El precio más votado; a igualdad, el que se leyó primero (el de la lectura base).
  const topVotes = (index: number) => Math.max(0, ...votes[index].values())
  const tied = (index: number) => candidates[index].filter((price) => votes[index].get(cents(price)) === topVotes(index))
  merged.forEach((line, index) => {
    if (candidates[index].length) line.totalPrice = tied(index)[0]
  })

  if (total == null) return merged
  const sum = () => merged.reduce((acc, line) => acc + cents(line.totalPrice ?? 0), 0)
  const target = cents(total)
  if (sum() === target) return merged

  // Productos con varios precios empatados en votos: se prueban las combinaciones
  // (como mucho 12 productos, 4096 combinaciones) y se usa la primera que cuadre.
  const doubtful = candidates.map((_, index) => ({ index, options: tied(index) })).filter((item) => item.options.length > 1).slice(0, 12)
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
