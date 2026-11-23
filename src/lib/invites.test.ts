import { describe, expect, it } from 'vitest'
import { formatInviteCode, inviteCodeFromUrl, inviteLink, inviteShareText, inviteStatus, normalizeInviteCode, type AppInvite } from './invites'

const invite = (patch: Partial<AppInvite> = {}): AppInvite => ({
  code: 'K7MQ2PXA', created_at: '2026-11-23T10:00:00Z', expires_at: '2026-11-30T10:00:00Z', revoked_at: null, used_email: null, used_at: null, ...patch,
})

describe('invitaciones', () => {
  it('normaliza y formatea el código', () => {
    expect(normalizeInviteCode(' k7mq-2pxa ')).toBe('K7MQ2PXA')
    expect(formatInviteCode('k7mq2pxa')).toBe('K7MQ-2PXA')
  })

  it('calcula el estado', () => {
    const now = new Date('2026-11-25T10:00:00Z')
    expect(inviteStatus(invite(), now)).toBe('activa')
    expect(inviteStatus(invite({ used_at: '2026-11-24T10:00:00Z', used_email: 'ana@l' }), now)).toBe('usada')
    expect(inviteStatus(invite({ revoked_at: '2026-11-24T10:00:00Z' }), now)).toBe('anulada')
    expect(inviteStatus(invite({ expires_at: '2026-11-24T10:00:00Z' }), now)).toBe('caducada')
  })

  it('crea y lee el enlace de invitación', () => {
    const link = inviteLink('K7MQ-2PXA', 'https://estilofutbol.github.io/Menu/')
    expect(link).toBe('https://estilofutbol.github.io/Menu/?invitacion=K7MQ2PXA')
    expect(inviteCodeFromUrl(link)).toBe('K7MQ2PXA')
    expect(inviteCodeFromUrl('https://estilofutbol.github.io/Menu/')).toBeNull()
  })

  it('el mensaje para compartir dice a qué se invita', () => {
    expect(inviteShareText('k7mq2pxa')).toMatch(/Te invito a Menu.*K7MQ-2PXA/)
    const household = inviteShareText('K7MQ2PXA', 'Casa')
    expect(household).toMatch(/mi hogar «Casa».*K7MQ-2PXA/)
    expect(household).toMatch(/Unirme a un hogar/)
  })
})
