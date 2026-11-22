import { formatQuantity } from './domain'

// Resultado de undo_consumption: lo devuelto a la despensa y lo que no se pudo
// devolver porque ahora el producto está en una unidad que no se puede sumar.
export type UndoResult = {
  returned?: Array<{ name: string; quantity: number; unit: string }>
  skipped?: Array<{ name: string; quantity: number; unit: string; pantry_unit: string }>
}

const amount = (quantity: number, unit: string) => `${formatQuantity(Number(quantity))} ${unit}`

export function describeUndo(name: string, result: UndoResult | null) {
  const returned = result?.returned ?? []
  const skipped = result?.skipped ?? []
  const parts = [`«${name}» vuelve a estar pendiente en el menú.`]
  if (returned.length) parts.push(`Devuelto a la despensa: ${returned.map((item) => `${item.name} ${amount(item.quantity, item.unit)}`).join(', ')}.`)
  else if (!skipped.length) parts.push('No se había descontado nada de la despensa, así que no se devuelve nada.')
  if (skipped.length) parts.push(`No se ha podido devolver (en la despensa ahora está en otra unidad): ${skipped.map((item) => `${item.name} ${amount(item.quantity, item.unit)}`).join(', ')}. Ajústalo a mano en Despensa.`)
  return parts.join(' ')
}
