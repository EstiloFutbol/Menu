import { beforeEach, describe, expect, it, vi } from 'vitest'

// Imita a Supabase: la llamada solo se envía cuando alguien la espera (.then / await).
const sent: string[] = []
let failures = 0
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (name: string, args: { p_tutorial: string }) => ({
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        sent.push(`${name}:${args.p_tutorial}`)
        const error = failures > 0 ? (failures--, { message: 'sin conexión' }) : null
        return Promise.resolve({ data: null, error }).then(resolve, reject)
      },
    }),
    from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { tutorials_seen: [] }, error: null }) }) }),
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}))

const { closeTutorial, saveTutorialSeen, startTutorial } = await import('./tutorial')

describe('guardar que se ha visto un tutorial', () => {
  beforeEach(() => { sent.length = 0; failures = 0 })

  it('al saltarlo se envía de verdad a Supabase', async () => {
    startTutorial('recetas')
    closeTutorial()
    await vi.waitFor(() => expect(sent).toEqual(['mark_tutorial_seen:recetas']))
  })

  it('si falla, lo reintenta', async () => {
    failures = 1
    await expect(saveTutorialSeen('menu', 3, 0)).resolves.toBe(true)
    expect(sent).toEqual(['mark_tutorial_seen:menu', 'mark_tutorial_seen:menu'])
  })

  it('si falla siempre, se rinde sin romper nada', async () => {
    failures = 5
    await expect(saveTutorialSeen('menu', 2, 0)).resolves.toBe(false)
    expect(sent).toHaveLength(2)
  })
})
