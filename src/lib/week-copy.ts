// Resultado de copy_menu_week y su resumen para el aviso del menú.
export type WeekCopyResult = {
  slots: number
  recipes: number
  products: number
  skipped: Array<{ planned_date: string; meal: string; reason: 'planned' | 'eating_out' }>
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function describeWeekCopy(result: WeekCopyResult, targetLabel: string, describeSlot: (date: string, meal: string) => string) {
  const parts: string[] = []
  const content = [
    result.recipes ? plural(result.recipes, 'receta', 'recetas') : '',
    result.products ? plural(result.products, 'producto', 'productos') : '',
  ].filter(Boolean).join(' y ')
  parts.push(result.slots
    ? `Semana copiada a ${targetLabel}: ${plural(result.slots, 'franja', 'franjas')}${content ? ` (${content}, como pendientes)` : ''}.`
    : `No se ha copiado nada a ${targetLabel}.`)
  const planned = result.skipped.filter((item) => item.reason === 'planned')
  const eatingOut = result.skipped.filter((item) => item.reason === 'eating_out')
  if (planned.length) parts.push(`«Comida fuera» no se ha copiado en ${planned.map((item) => describeSlot(item.planned_date, item.meal)).join(', ')} porque ya tenía algo planificado.`)
  if (eatingOut.length) parts.push(`No se ha copiado nada en ${eatingOut.map((item) => describeSlot(item.planned_date, item.meal)).join(', ')} porque está marcado como «Comida fuera».`)
  return parts.join(' ')
}
