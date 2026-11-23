import { describe, expect, it } from 'vitest'
import { describeNotesCopy, moveItem, plannedDaySummary, splitQuickItems } from './simple'

describe('modo sencillo', () => {
  it('una cosa por línea, sin viñetas ni líneas vacías', () => {
    expect(splitQuickItems('Pan')).toEqual(['Pan'])
    expect(splitQuickItems('- pan\n• leche  entera\n\n[ ] huevos\n[x] aceite\n1. tomates\r\n  ')).toEqual(['pan', 'leche entera', 'huevos', 'aceite', 'tomates'])
    expect(splitQuickItems('a'.repeat(250))[0]).toHaveLength(200)
    expect(splitQuickItems('   \n ')).toEqual([])
  })

  it('resume lo planificado en el menú completo', () => {
    expect(plannedDaySummary([
      { menu_entry_recipes: [{ sort_order: 1, recipe: { name: 'Tortilla' } }, { sort_order: 0, recipe: { name: 'Lentejas' } }], menu_entry_products: [{ ingredient: { name: 'Yogur' } }] },
      { is_eating_out: true },
      { menu_entry_recipes: [{ recipe: { name: 'Lentejas' } }] },
    ])).toBe('Lentejas, Tortilla, Yogur, comida fuera')
    expect(plannedDaySummary([])).toBe('')
  })

  it('explica la copia de la semana', () => {
    expect(describeNotesCopy({ copied: 3, kept: 0 })).toBe('Copiados 3 días.')
    expect(describeNotesCopy({ copied: 1, kept: 2 })).toBe('Copiado 1 día. 2 días ya tenían texto y no se han tocado.')
    expect(describeNotesCopy({ copied: 0, kept: 1 })).toBe('No se ha copiado nada. 1 día ya tenía texto y no se ha tocado.')
    expect(describeNotesCopy({})).toBe('No había nada escrito que copiar esta semana.')
  })

  it('sube y baja apuntes intercambiando posiciones', () => {
    const items = [{ id: 'a', position: 1 }, { id: 'b', position: 2 }, { id: 'c', position: 3 }]
    expect(moveItem(items, 'b', -1)).toEqual([{ id: 'b', position: 1 }, { id: 'a', position: 2 }])
    expect(moveItem(items, 'c', 1)).toEqual([])
    expect(moveItem([{ id: 'a', position: 0 }, { id: 'b', position: 0 }], 'a', 1)).toEqual([{ id: 'a', position: 1 }, { id: 'b', position: 0 }])
  })
})
