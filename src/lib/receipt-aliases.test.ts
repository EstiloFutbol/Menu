import { describe, expect, it } from 'vitest'
import { aliasConcept, filterAliases, normalizeSearch, sortAliases, type ReceiptAlias } from './receipt-aliases'

const make = (id: string, raw: string | null, normalized: string, product: string): ReceiptAlias => ({
  id, raw_name: raw, normalized_name: normalized, ingredient_id: `i-${id}`, ingredient: { id: `i-${id}`, name: product },
})

const aliases = [
  make('1', 'PECH POLLO FIL', 'pech pollo fil', 'Pechuga de pollo'),
  make('2', null, 'aceite oliva', 'Aceite de oliva'),
  make('3', 'ÁTÚN CLARO', 'atun claro', 'Atún'),
]

describe('receipt-aliases', () => {
  it('normaliza sin tildes ni mayúsculas', () => {
    expect(normalizeSearch('  ÁTÚN   Claro ')).toBe('atun claro')
  })
  it('usa normalized_name si no hay raw_name', () => {
    expect(aliasConcept(aliases[1])).toBe('aceite oliva')
  })
  it('filtra por concepto o producto', () => {
    expect(filterAliases(aliases, 'atun').map((a) => a.id)).toEqual(['3'])
    expect(filterAliases(aliases, 'PECHUGA').map((a) => a.id)).toEqual(['1'])
    expect(filterAliases(aliases, 'oliva').map((a) => a.id)).toEqual(['2'])
    expect(filterAliases(aliases, '  ')).toHaveLength(3)
  })
  it('ordena alfabéticamente por concepto', () => {
    expect(sortAliases(aliases).map((a) => a.id)).toEqual(['2', '3', '1'])
  })
})
