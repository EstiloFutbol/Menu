import { describe, expect, it } from 'vitest'
import { matchesSearch, normalizeSearch, rankBySearch } from './search'

describe('buscador', () => {
  it('ignora mayúsculas, tildes y espacios', () => {
    expect(normalizeSearch('  Plátano   de CANARIAS ')).toBe('platano de canarias')
    expect(matchesSearch('Plátano de Canarias', 'platano')).toBe(true)
    expect(matchesSearch('Leche sin lactosa', 'lactosa  LECHE')).toBe(true)
    expect(matchesSearch('Leche entera', 'leche sin')).toBe(false)
    expect(matchesSearch('Lo que sea', '   ')).toBe(true)
  })

  it('pone primero lo que empieza por lo buscado', () => {
    const items = ['Pan de molde', 'Ajo', 'Ajonjolí', 'Pimiento rojo', 'Sopa de ajo']
    expect(rankBySearch(items, 'ajo', (item) => item)).toEqual(['Ajo', 'Ajonjolí', 'Sopa de ajo'])
    expect(rankBySearch(items, '', (item) => item)).toEqual(items)
  })
})
