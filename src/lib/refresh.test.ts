import { describe, expect, it } from 'vitest'
import { AWAY_MS, shouldRefreshOnReturn } from './refresh'

describe('recargar al volver a la app', () => {
  it('solo tras un rato fuera y sin cambios sin guardar', () => {
    expect(shouldRefreshOnReturn(1000, 1000 + AWAY_MS, false)).toBe(true)
    expect(shouldRefreshOnReturn(1000, 1000 + AWAY_MS - 1, false)).toBe(false)
    expect(shouldRefreshOnReturn(1000, 1000 + AWAY_MS * 5, true)).toBe(false)
    expect(shouldRefreshOnReturn(null, 1000 + AWAY_MS, false)).toBe(false)
  })
})
