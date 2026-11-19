// Lógica pura para gestionar las traducciones recordadas de los tickets.

export type ReceiptAlias = {
  id: string
  raw_name: string | null
  normalized_name: string
  ingredient_id: string
  ingredient: { id: string; name: string } | null
}

// Minúsculas, sin tildes y con espacios simplificados, para buscar.
export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Texto del ticket a mostrar: el original o, si no hay, el normalizado.
export function aliasConcept(alias: Pick<ReceiptAlias, 'raw_name' | 'normalized_name'>): string {
  return alias.raw_name?.trim() || alias.normalized_name
}

export function filterAliases(aliases: ReceiptAlias[], query: string): ReceiptAlias[] {
  const needle = normalizeSearch(query)
  if (!needle) return aliases
  return aliases.filter((alias) => normalizeSearch(aliasConcept(alias)).includes(needle) || normalizeSearch(alias.ingredient?.name ?? '').includes(needle))
}

export function sortAliases(aliases: ReceiptAlias[]): ReceiptAlias[] {
  return [...aliases].sort((a, b) => aliasConcept(a).localeCompare(aliasConcept(b), 'es', { sensitivity: 'base' }))
}
