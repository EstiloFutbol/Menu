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
