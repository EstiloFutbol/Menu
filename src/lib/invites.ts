// Invitaciones a la app: solo se puede crear una cuenta con el código de alguien
// que ya la usa (la base de datos rechaza las altas sin código válido).
export type AppInvite = {
  code: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  used_email: string | null
  used_at: string | null
}

export type InviteStatus = 'activa' | 'usada' | 'caducada' | 'anulada'

// Mismo formato que en la base de datos: mayúsculas, sin guiones ni espacios.
export function normalizeInviteCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// "K7MQ2PXA" → "K7MQ-2PXA", más fácil de leer y dictar.
export function formatInviteCode(code: string) {
  const clean = normalizeInviteCode(code)
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean
}

export function inviteStatus(invite: AppInvite, now = new Date()): InviteStatus {
  if (invite.used_at) return 'usada'
  if (invite.revoked_at) return 'anulada'
  if (new Date(invite.expires_at) <= now) return 'caducada'
  return 'activa'
}

// Enlace que abre la app con el código ya escrito en «Crear cuenta».
export function inviteLink(code: string, appUrl: string) {
  const url = new URL(appUrl)
  url.searchParams.set('invitacion', normalizeInviteCode(code))
  return url.toString()
}

// Código del enlace de invitación (?invitacion=…), si lo hay.
export function inviteCodeFromUrl(href: string) {
  const code = new URL(href).searchParams.get('invitacion')
  return code ? normalizeInviteCode(code) : null
}
