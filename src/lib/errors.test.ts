import { describe, expect, it } from 'vitest'
import { friendlyError } from './errors'

describe('friendlyError', () => {
  it('translates messages raised by our SQL functions', () => {
    expect(friendlyError({ message: 'Invalid recipe', code: 'P0001' }, 'x')).toBe('Alguna de las recetas ya no existe.')
  })

  it('uses context-specific messages for foreign key and unique violations', () => {
    const fk = { message: 'update or delete on table "recipes" violates foreign key constraint', code: '23503' }
    expect(friendlyError(fk, 'x', { inUse: 'Está en el menú.' })).toBe('Está en el menú.')
    expect(friendlyError({ message: 'duplicate key value violates unique constraint', code: '23505' }, 'x', { duplicate: 'Ya existe.' })).toBe('Ya existe.')
  })

  it('hides unexpected database details behind the fallback', () => {
    expect(friendlyError({ message: 'column "foo" does not exist', code: '42703' }, 'No se pudo guardar.')).toBe('No se pudo guardar.')
    expect(friendlyError(new Error('new row violates check constraint "x"'), 'No se pudo guardar.')).toBe('No se pudo guardar.')
  })

  it('keeps our own user-facing messages and handles network errors', () => {
    expect(friendlyError(new Error('Indica una cantidad válida.'), 'x')).toBe('Indica una cantidad válida.')
    expect(friendlyError(new TypeError('Failed to fetch'), 'x')).toBe('No hay conexión. Comprueba tu red e inténtalo de nuevo.')
    expect(friendlyError(null, 'Fallback')).toBe('Fallback')
  })
})

describe('errores al fusionar productos', () => {
  it('explica por qué no se puede borrar y los choques de unidades', () => {
    expect(friendlyError({ message: 'Este producto ya tiene uso en recetas, menú, compras o consumos. No se puede eliminar sin perder histórico.', code: 'P0001' }, 'x')).toMatch(/fusionarlo/)
    expect(friendlyError({ message: 'Merge conflict in pantry: 6.00 unidad and 300.00 g', code: 'P0001' }, 'x')).toBe('En la despensa tienes uno en unidad y el otro en g, y no se pueden sumar. Ajusta uno de los dos en Despensa y vuelve a intentarlo.')
    expect(friendlyError({ message: 'Merge conflict in menu', code: 'P0001' }, 'x')).toMatch(/misma comida del menú/)
  })
})

describe('errores del hogar', () => {
  it('explica por qué no se puede', () => {
    expect(friendlyError({ message: 'Cannot leave the personal household', code: 'P0001' }, 'x')).toMatch(/hogar personal no se puede dejar/)
    expect(friendlyError({ message: 'Invalid invite code', code: 'P0001' }, 'x')).toMatch(/no es válido/)
    expect(friendlyError({ message: 'Only the household owner can invite', code: 'P0001' }, 'x')).toMatch(/responsable/)
  })
})
