export type MeasurementUnit = 'g' | 'kg' | 'ml' | 'l' | 'unidad' | 'cucharada' | 'cucharadita' | 'taza' | 'lata' | 'paquete'

export type PantryVisibilityItem = {
  quantity: number | null
  status: 'tengo' | 'queda_poco' | 'no_tengo' | null
}

export function convertCompatibleQuantity(quantity: number, from: MeasurementUnit, to: MeasurementUnit) {
  if (from === to) return quantity
  if (from === 'g' && to === 'kg') return quantity / 1000
  if (from === 'kg' && to === 'g') return quantity * 1000
  if (from === 'ml' && to === 'l') return quantity / 1000
  if (from === 'l' && to === 'ml') return quantity * 1000
  return null
}

export function shouldShowPantryItem(item: PantryVisibilityItem) {
  if (item.quantity !== null) return item.quantity > 0
  return item.status !== 'no_tengo'
}

export function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const weekday = result.getDay()
  result.setDate(result.getDate() + (weekday === 0 ? -6 : 1 - weekday))
  return result
}

export function addDays(date: Date, days: number) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() + days)
  return result
}

export function localDateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export type PantryStock = {
  quantity: number | null
  unit: MeasurementUnit | null
  status: 'tengo' | 'queda_poco' | 'no_tengo' | null
}

export type PlannedLine = { ingredientId: string; quantity: number; unit: MeasurementUnit }
export type AggregatedNeed = { ingredientId: string; baseUnit: MeasurementUnit; needed: number }
export type NeedComparison = { have: number | null; missing: number; pantryCheckRequired: boolean }

// Peso y volumen se normalizan a g y ml; el resto de unidades se mantiene.
export function toBaseQuantity(quantity: number, unit: MeasurementUnit): { quantity: number; unit: MeasurementUnit } {
  if (unit === 'kg') return { quantity: quantity * 1000, unit: 'g' }
  if (unit === 'l') return { quantity: quantity * 1000, unit: 'ml' }
  return { quantity, unit }
}

export function areUnitsCompatible(a: MeasurementUnit, b: MeasurementUnit) {
  return toBaseQuantity(1, a).unit === toBaseQuantity(1, b).unit
}

// Suma lo planificado por producto y unidad base. Un mismo producto en unidades
// incompatibles (por ejemplo g y unidad) queda en dos necesidades separadas.
export function aggregateNeeds(lines: PlannedLine[]): AggregatedNeed[] {
  const needs = new Map<string, AggregatedNeed>()
  for (const line of lines) {
    const base = toBaseQuantity(line.quantity, line.unit)
    const key = `${line.ingredientId}:${base.unit}`
    const current = needs.get(key)
    needs.set(key, { ingredientId: line.ingredientId, baseUnit: base.unit, needed: (current?.needed ?? 0) + base.quantity })
  }
  return Array.from(needs.values())
}

// Compara una necesidad con la despensa. `have` es null cuando no se puede saber cuánto hay
// (despensa por estado o en una unidad incompatible); en ese caso hay que revisar la despensa.
export function compareNeedWithPantry(need: AggregatedNeed, pantry: PantryStock | undefined): NeedComparison {
  if (!pantry) return { have: 0, missing: need.needed, pantryCheckRequired: false }
  if (pantry.quantity != null && pantry.unit) {
    if (!areUnitsCompatible(pantry.unit, need.baseUnit)) return { have: null, missing: need.needed, pantryCheckRequired: true }
    const have = toBaseQuantity(Number(pantry.quantity), pantry.unit).quantity
    return { have, missing: Math.max(0, need.needed - have), pantryCheckRequired: false }
  }
  if (pantry.status === 'tengo' || pantry.status === 'queda_poco') return { have: null, missing: need.needed, pantryCheckRequired: true }
  return { have: 0, missing: need.needed, pantryCheckRequired: false }
}

export type PlanEntryForNeeds = {
  is_eating_out?: boolean
  menu_entry_recipes?: Array<{
    id: string
    servings: number
    recipe: { base_servings: number; recipe_ingredients?: Array<{ ingredient_id: string; quantity: number; unit: MeasurementUnit }> } | null
  }>
  menu_entry_products?: Array<{ id: string; ingredient_id: string; quantity: number; unit: MeasurementUnit }>
  consumption_logs?: Array<{ menu_entry_recipe_id: string | null; menu_entry_product_id: string | null }>
}

// Lo que el menú aún necesita: ingredientes de recetas (escalados por raciones) y productos directos.
// Lo ya consumido se omite porque al completarlo ya se descontó de la despensa.
export function pendingPlannedLines(entries: PlanEntryForNeeds[]): PlannedLine[] {
  const lines: PlannedLine[] = []
  for (const entry of entries) {
    if (entry.is_eating_out) continue
    const consumedRecipeRows = new Set(entry.consumption_logs?.map((log) => log.menu_entry_recipe_id).filter(Boolean))
    const consumedProductRows = new Set(entry.consumption_logs?.map((log) => log.menu_entry_product_id).filter(Boolean))

    for (const planned of entry.menu_entry_recipes ?? []) {
      if (consumedRecipeRows.has(planned.id) || !planned.recipe || !Number(planned.recipe.base_servings)) continue
      const scale = Number(planned.servings) / Number(planned.recipe.base_servings)
      for (const item of planned.recipe.recipe_ingredients ?? []) {
        lines.push({ ingredientId: item.ingredient_id, quantity: Number(item.quantity) * scale, unit: item.unit })
      }
    }

    for (const product of entry.menu_entry_products ?? []) {
      if (consumedProductRows.has(product.id)) continue
      lines.push({ ingredientId: product.ingredient_id, quantity: Number(product.quantity), unit: product.unit })
    }
  }
  return lines
}
