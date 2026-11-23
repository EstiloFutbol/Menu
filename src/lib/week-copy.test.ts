import { describe, expect, it } from 'vitest'
import { describeWeekCopy } from './week-copy'

const slot = (date: string, meal: string) => `${meal} del ${date.slice(8)}`

describe('copiar una semana', () => {
  it('resume lo copiado', () => {
    expect(describeWeekCopy({ slots: 9, recipes: 7, products: 1, skipped: [] }, 'la semana del 23 – 29 nov', slot))
      .toBe('Semana copiada a la semana del 23 – 29 nov: 9 comidas (7 recetas y 1 producto, como pendientes).')
  })

  it('explica lo que no se ha copiado', () => {
    const text = describeWeekCopy({ slots: 1, recipes: 1, products: 0, skipped: [
      { planned_date: '2026-11-24', meal: 'cena', reason: 'planned' },
      { planned_date: '2026-11-26', meal: 'comida', reason: 'eating_out' },
    ] }, 'la semana del 23 – 29 nov', slot)
    expect(text).toContain('1 comida (1 receta, como pendientes)')
    expect(text).toContain('«Comida fuera» no se ha copiado en cena del 24 porque ya tenía algo planificado.')
    expect(text).toContain('No se ha copiado nada en comida del 26 porque está marcado como «Comida fuera».')
  })

  it('avisa si no había nada que copiar', () => {
    expect(describeWeekCopy({ slots: 0, recipes: 0, products: 0, skipped: [] }, 'la semana del 23 – 29 nov', slot)).toBe('No se ha copiado nada a la semana del 23 – 29 nov.')
  })
})
