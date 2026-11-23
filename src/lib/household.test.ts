import { describe, expect, it } from 'vitest'
import { copySummary, currentHousehold, householdFromRow, memberFromRow } from './household'

const row = (patch: Record<string, unknown> = {}) => ({ id: 'h1', name: 'Hogar de ana', is_personal: true, role: 'owner', member_count: 1, is_current: false, ...patch })

describe('hogares', () => {
  it('convierte las filas de la base de datos', () => {
    expect(householdFromRow(row())).toEqual({ id: 'h1', name: 'Hogar de ana', isPersonal: true, role: 'owner', memberCount: 1, isCurrent: false })
    expect(householdFromRow(row({ is_personal: null, role: 'raro', member_count: null })).role).toBe('member')
    expect(memberFromRow({ user_id: 'u', email: null, role: 'owner', joined_at: '2026-11-23', is_me: null })).toEqual({ userId: 'u', email: null, role: 'owner', joinedAt: '2026-11-23', isMe: false })
  })

  it('el hogar actual es el marcado; si no hay ninguno, el personal', () => {
    const personal = householdFromRow(row())
    const shared = householdFromRow(row({ id: 'h2', name: 'Casa', is_personal: false, role: 'member', member_count: 2 }))
    expect(currentHousehold([personal, { ...shared, isCurrent: true }])?.id).toBe('h2')
    expect(currentHousehold([personal, shared])?.id).toBe('h1')
    expect(currentHousehold([])).toBeNull()
  })

  it('resume lo copiado al salir de un hogar', () => {
    expect(copySummary({ recipes: 2, purchases: 1, products: 3, aliases: 1 })).toBe('Se ha copiado a tu hogar: 2 recetas, 1 compra y 3 productos nuevos.')
    expect(copySummary({ recipes: 1, purchases: 0, products: 0 })).toBe('Se ha copiado a tu hogar: 1 receta.')
    expect(copySummary({})).toBe('No había recetas ni compras tuyas que copiar.')
    expect(copySummary(null)).toBe('No había recetas ni compras tuyas que copiar.')
  })
})
