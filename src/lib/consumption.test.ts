import { describe, expect, it } from 'vitest'
import { describeUndo } from './consumption'

describe('deshacer un consumo', () => {
  it('cuenta lo devuelto a la despensa', () => {
    expect(describeUndo('Arroz con salmón', { returned: [{ name: 'Salmón', quantity: 200, unit: 'g' }, { name: 'Arroz', quantity: 0.1, unit: 'kg' }], skipped: [] }))
      .toBe('«Arroz con salmón» vuelve a estar pendiente en el menú. Devuelto a la despensa: Salmón 200 g, Arroz 0,1 kg.')
  })

  it('no devuelve nada si no se había descontado nada', () => {
    expect(describeUndo('Yogur', { returned: [], skipped: [] })).toBe('«Yogur» vuelve a estar pendiente en el menú. No se había descontado nada de la despensa, así que no se devuelve nada.')
  })

  it('avisa de lo que no se ha podido devolver', () => {
    expect(describeUndo('Batido', { returned: [], skipped: [{ name: 'Leche', quantity: 200, unit: 'ml', pantry_unit: 'unidad' }] }))
      .toMatch(/No se ha podido devolver .*: Leche 200 ml\. Ajústalo a mano en Despensa\./)
  })
})
