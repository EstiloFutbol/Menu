import type { Session } from '@supabase/supabase-js'
import { LockKeyhole } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    setSubmitting(true)
    setError(null)

    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password })

    if (loginError) {
      setError('No se ha podido iniciar sesión. Revisa el correo y la contraseña.')
    }

    setSubmitting(false)
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f7f5] px-4">
        <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-7 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Falta conectar Supabase</h1>
          <p className="mt-3 text-sm leading-6 text-neutral-500">
            Configura VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY para poder usar Menu.
          </p>
        </div>
      </main>
    )
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center bg-[#f7f7f5] text-sm text-neutral-500">Cargando…</div>
  }

  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f7f5] px-4">
        <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-7 shadow-sm">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-900 text-white">
            <LockKeyhole size={20} />
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight">Menu</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-500">Tu planificación semanal, recetas, compra y despensa.</p>

          <form onSubmit={handleLogin} className="mt-7 space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-neutral-700">Correo electrónico</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-neutral-400"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-neutral-700">Contraseña</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-neutral-400"
              />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60"
            >
              {submitting ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>
      </main>
    )
  }

  return children
}
