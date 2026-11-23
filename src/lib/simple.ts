// Modo sencillo: el menú es un texto por día y la compra, una lista escrita a mano.

export const QUICK_ITEM_MAX = 200
export const DAY_NOTE_MAX = 2000

// Texto escrito o pegado en «Añadir a la lista»: una cosa por línea. Se quitan las
// viñetas y casillas de las listas copiadas de otras apps («- pan», «• leche», «[ ] huevos»).
export function splitQuickItems(input: string): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•·–]|\[\s?[xX]?\s?\]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((line) => line.slice(0, QUICK_ITEM_MAX))
}

type PlannedDayEntry = {
  is_eating_out?: boolean | null
  menu_entry_recipes?: Array<{ sort_order?: number; recipe?: { name?: string | null } | null }> | null
  menu_entry_products?: Array<{ sort_order?: number; ingredient?: { name?: string | null } | null }> | null
}

// «lentejas, yogur»: lo planificado en el menú completo para un día, para verlo en el sencillo.
export function plannedDaySummary(entries: PlannedDayEntry[]): string {
  const names: string[] = []
  for (const entry of entries) {
    if (entry.is_eating_out) { names.push('comida fuera'); continue }
    const recipes = [...(entry.menu_entry_recipes ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    const products = [...(entry.menu_entry_products ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    for (const item of recipes) if (item.recipe?.name) names.push(item.recipe.name)
    for (const item of products) if (item.ingredient?.name) names.push(item.ingredient.name)
  }
  return [...new Set(names)].join(', ')
}

export function describeNotesCopy(result: { copied?: number; kept?: number } | null | undefined): string {
  const copied = result?.copied ?? 0
  const kept = result?.kept ?? 0
  if (!copied && !kept) return 'No había nada escrito que copiar esta semana.'
  const parts = [copied ? `Copiado${copied === 1 ? '' : 's'} ${copied} día${copied === 1 ? '' : 's'}.` : 'No se ha copiado nada.']
  if (kept) parts.push(`${kept} día${kept === 1 ? '' : 's'} ya tenía${kept === 1 ? '' : 'n'} texto y no se ha${kept === 1 ? '' : 'n'} tocado.`)
  return parts.join(' ')
}

// Nuevo orden al subir o bajar un apunte: intercambia su posición con la del vecino.
export function moveItem<T extends { id: string; position: number }>(items: T[], id: string, direction: -1 | 1): Array<{ id: string; position: number }> {
  const sorted = [...items].sort((a, b) => a.position - b.position)
  const index = sorted.findIndex((item) => item.id === id)
  const other = sorted[index + direction]
  if (index < 0 || !other) return []
  const current = sorted[index]
  // Si las posiciones coinciden (datos antiguos), se separan.
  const a = other.position === current.position ? current.position + direction : other.position
  return [{ id: current.id, position: a }, { id: other.id, position: current.position }]
}
