import { describe, expect, it } from 'vitest'
import { addDays, aggregateNeeds, compareNeedWithPantry, convertCompatibleQuantity, localDateString, pendingPlannedLines, shouldShowPantryItem, startOfWeek } from './domain'

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

describe('aggregateNeeds', () => {
  it('sums compatible units in base unit and keeps incompatible ones apart', () => {
    const needs = aggregateNeeds([
      { ingredientId: 'pollo', quantity: 0.3, unit: 'kg' },
      { ingredientId: 'pollo', quantity: 200, unit: 'g' },
      { ingredientId: 'pollo', quantity: 2, unit: 'unidad' },
    ])
    expect(needs).toEqual([
      { ingredientId: 'pollo', baseUnit: 'g', needed: 500 },
      { ingredientId: 'pollo', baseUnit: 'unidad', needed: 2 },
    ])
  })
})

describe('compareNeedWithPantry', () => {
  const need = { ingredientId: 'leche', baseUnit: 'ml' as const, needed: 1500 }

  it('subtracts compatible pantry quantities', () => {
    expect(compareNeedWithPantry(need, { quantity: 1, unit: 'l', status: null })).toEqual({ have: 1000, missing: 500, pantryCheckRequired: false })
    expect(compareNeedWithPantry(need, { quantity: 2, unit: 'l', status: null })).toEqual({ have: 2000, missing: 0, pantryCheckRequired: false })
  })

  it('asks for a pantry check when the amount is unknown', () => {
    expect(compareNeedWithPantry(need, { quantity: 2, unit: 'unidad', status: null })).toEqual({ have: null, missing: 1500, pantryCheckRequired: true })
    expect(compareNeedWithPantry(need, { quantity: null, unit: null, status: 'queda_poco' })).toEqual({ have: null, missing: 1500, pantryCheckRequired: true })
  })

  it('treats missing or empty pantry as nothing in stock', () => {
    expect(compareNeedWithPantry(need, undefined)).toEqual({ have: 0, missing: 1500, pantryCheckRequired: false })
    expect(compareNeedWithPantry(need, { quantity: null, unit: null, status: 'no_tengo' })).toEqual({ have: 0, missing: 1500, pantryCheckRequired: false })
  })
})

describe('pendingPlannedLines', () => {
  it('scales recipes, includes direct products and skips consumed rows and eating out', () => {
    const lines = pendingPlannedLines([
      {
        menu_entry_recipes: [
          { id: 'r1', servings: 4, recipe: { base_servings: 2, recipe_ingredients: [{ ingredient_id: 'arroz', quantity: 100, unit: 'g' }] } },
          { id: 'r2', servings: 2, recipe: { base_servings: 2, recipe_ingredients: [{ ingredient_id: 'arroz', quantity: 100, unit: 'g' }] } },
        ],
        menu_entry_products: [
          { id: 'p1', ingredient_id: 'yogur', quantity: 1, unit: 'unidad' },
          { id: 'p2', ingredient_id: 'yogur', quantity: 2, unit: 'unidad' },
        ],
        consumption_logs: [{ menu_entry_recipe_id: 'r2', menu_entry_product_id: null }, { menu_entry_recipe_id: null, menu_entry_product_id: 'p2' }],
      },
      { is_eating_out: true, menu_entry_products: [{ id: 'p3', ingredient_id: 'pan', quantity: 1, unit: 'unidad' }] },
    ])
    expect(lines).toEqual([
      { ingredientId: 'arroz', quantity: 200, unit: 'g' },
      { ingredientId: 'yogur', quantity: 1, unit: 'unidad' },
    ])
  })
})
