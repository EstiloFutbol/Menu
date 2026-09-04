import { describe, expect, it } from 'vitest'
import { addDays, convertCompatibleQuantity, localDateString, shouldShowPantryItem, startOfWeek } from './domain'

describe('convertCompatibleQuantity', () => {
  it('converts mass and volume units', () => {
    expect(convertCompatibleQuantity(500, 'g', 'kg')).toBe(0.5)
    expect(convertCompatibleQuantity(1.5, 'kg', 'g')).toBe(1500)
    expect(convertCompatibleQuantity(750, 'ml', 'l')).toBe(0.75)
    expect(convertCompatibleQuantity(2, 'l', 'ml')).toBe(2000)
  })

  it('keeps equal units and rejects incompatible units', () => {
    expect(convertCompatibleQuantity(3, 'unidad', 'unidad')).toBe(3)
    expect(convertCompatibleQuantity(1, 'kg', 'l')).toBeNull()
  })
})

describe('shouldShowPantryItem', () => {
  it('hides zero stock and explicit no-stock states', () => {
    expect(shouldShowPantryItem({ quantity: 0, status: null })).toBe(false)
    expect(shouldShowPantryItem({ quantity: null, status: 'no_tengo' })).toBe(false)
  })

  it('shows positive quantities and useful status-only items', () => {
    expect(shouldShowPantryItem({ quantity: 0.25, status: null })).toBe(true)
    expect(shouldShowPantryItem({ quantity: null, status: 'queda_poco' })).toBe(true)
    expect(shouldShowPantryItem({ quantity: null, status: 'tengo' })).toBe(true)
  })
})

describe('week helpers', () => {
  it('starts weeks on Monday, including when input is Sunday', () => {
    const monday = startOfWeek(new Date(2026, 8, 4))
    expect(localDateString(monday)).toBe('2026-08-31')

    const sunday = startOfWeek(new Date(2026, 8, 6))
    expect(localDateString(sunday)).toBe('2026-08-31')
  })

  it('adds calendar days without mutating the input', () => {
    const start = new Date(2026, 8, 4)
    const next = addDays(start, 7)
    expect(localDateString(start)).toBe('2026-09-04')
    expect(localDateString(next)).toBe('2026-09-11')
  })
})
