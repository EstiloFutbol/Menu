// Búsqueda de textos sin tener en cuenta mayúsculas, tildes ni espacios de más:
// «platano» encuentra «Plátano de Canarias».

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Todas las palabras buscadas tienen que aparecer, en cualquier orden: «leche sin» encuentra «Leche sin lactosa».
export function matchesSearch(text: string, query: string): boolean {
  const words = normalizeSearch(query).split(' ').filter(Boolean)
  if (!words.length) return true
  const haystack = normalizeSearch(text)
  return words.every((word) => haystack.includes(word))
}

// Primero lo que empieza por lo buscado, después el resto, conservando el orden original.
export function rankBySearch<T>(items: T[], query: string, text: (item: T) => string): T[] {
  const wanted = normalizeSearch(query)
  const matching = items.filter((item) => matchesSearch(text(item), query))
  if (!wanted) return matching
  const starts = matching.filter((item) => normalizeSearch(text(item)).startsWith(wanted))
  return [...starts, ...matching.filter((item) => !starts.includes(item))]
}
