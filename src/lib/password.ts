export const MIN_PASSWORD_LENGTH = 8

// Valida la contraseña nueva y su repetición. Devuelve un mensaje de error o null si es válida.
export function validateNewPassword(password: string, repeat: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  if (password !== repeat) return 'Las contraseñas no coinciden.'
  return null
}
