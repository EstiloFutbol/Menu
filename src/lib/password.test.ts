import { describe, expect, it } from 'vitest'
import { validateNewPassword } from './password'

describe('validateNewPassword', () => {
  it('rechaza contraseñas de menos de 8 caracteres', () => {
    expect(validateNewPassword('corta12', 'corta12')).toMatch(/al menos 8/)
    expect(validateNewPassword('', '')).toMatch(/al menos 8/)
  })
  it('rechaza si no coinciden', () => {
    expect(validateNewPassword('12345678', '12345679')).toBe('Las contraseñas no coinciden.')
  })
  it('acepta contraseñas válidas que coinciden', () => {
    expect(validateNewPassword('12345678', '12345678')).toBeNull()
  })
})
