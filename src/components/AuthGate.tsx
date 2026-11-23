import type { Session } from '@supabase/supabase-js'
import { LockKeyhole, MailCheck } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { formatInviteCode, inviteCodeFromUrl, normalizeInviteCode } from '../lib/invites'
import { validateNewPassword } from '../lib/password'

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Crear cuenta: solo con el código de invitación de alguien que ya usa la app.
  // Un enlace de invitación (?invitacion=CODIGO) abre directamente el registro con el código escrito.
  const [mode, setMode] = useState<'login' | 'signup'>(() => (inviteCodeFromUrl(window.location.href) ? 'signup' : 'login'))
  const [inviteCode, setInviteCode] = useState(() => formatInviteCode(inviteCodeFromUrl(window.location.href) ?? ''))
  const [repeatPassword, setRepeatPassword] = useState('')
  const [signupEmail, setSignupEmail] = useState<string | null>(null)

  useEffect(() => {
    // Se quita el código de la barra de direcciones para que no se quede en el historial.
    const url = new URL(window.location.href)
    if (url.searchParams.has('invitacion')) {
      url.searchParams.delete('invitacion')
      window.history.replaceState(null, '', url.toString())
    }
  }, [])

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

  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const code = normalizeInviteCode(inviteCode)
    if (code.length !== 8) { setError('El código de invitación tiene 8 letras y números, por ejemplo K7MQ-2PXA.'); return }
    const passwordError = validateNewPassword(password, repeatPassword)
    if (passwordError) { setError(passwordError); return }

    setSubmitting(true)
    setError(null)
    // Se comprueba el código antes para dar un mensaje claro; la base de datos lo vuelve a comprobar al crear la cuenta.
    const { data: valid, error: checkError } = await supabase.rpc('check_app_invite', { p_code: code })
    if (checkError || !valid) {
      setError(checkError ? 'Ahora mismo no se pueden crear cuentas nuevas.' : 'El código de invitación no es válido, ha caducado o ya se usó.')
      setSubmitting(false)
      return
    }
    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { invite_code: code }, emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).toString() },
    })
    setSubmitting(false)
    if (signupError) { setError(friendlyError(signupError, 'No se pudo crear la cuenta.')); return }
    // Con la confirmación por correo activada no hay sesión todavía: hay que confirmar el correo.
    if (!data.session) setSignupEmail(email)
  }

  function switchMode(next: 'login' | 'signup') {
    setMode(next)
    setError(null)
    setPassword('')
    setRepeatPassword('')
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

          {signupEmail ? (
            <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <MailCheck size={20} className="text-emerald-700" />
              <p className="mt-2 font-medium">Cuenta creada. Falta confirmar el correo.</p>
              <p className="mt-1 text-emerald-800">Te hemos enviado un correo a <strong>{signupEmail}</strong>. Ábrelo y pulsa el enlace para confirmar la cuenta; después entra aquí con tu correo y contraseña.</p>
              <button type="button" onClick={() => { setSignupEmail(null); switchMode('login') }} className="mt-3 font-medium text-emerald-800 underline underline-offset-2">Ir a entrar</button>
            </div>
          ) : mode === 'signup' ? (
          <form onSubmit={handleSignup} className="mt-7 space-y-4">
            <p className="rounded-2xl bg-neutral-50 px-4 py-3 text-sm text-neutral-600">Para crear una cuenta necesitas el código de invitación de alguien que ya usa Menu.</p>
            <label className="block">
              <span className="text-sm font-medium text-neutral-700">Código de invitación</span>
              <input
                required
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                placeholder="K7MQ-2PXA"
                className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 font-mono text-sm tracking-wider outline-none transition focus:border-neutral-400"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-neutral-700">Correo electrónico</span>
              <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-neutral-400" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-neutral-700">Contraseña</span>
              <input type="password" autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-neutral-400" />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-neutral-700">Repite la contraseña</span>
              <input type="password" autoComplete="new-password" required value={repeatPassword} onChange={(event) => setRepeatPassword(event.target.value)} className="mt-1.5 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-neutral-400" />
            </label>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button type="submit" disabled={submitting} className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60">
              {submitting ? 'Creando cuenta…' : 'Crear cuenta'}
            </button>
            <button type="button" onClick={() => switchMode('login')} className="w-full text-sm font-medium text-neutral-500 hover:text-neutral-800">Ya tengo cuenta: entrar</button>
          </form>
          ) : (
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
            <button type="button" onClick={() => switchMode('signup')} className="w-full text-sm font-medium text-neutral-500 hover:text-neutral-800">¿Tienes una invitación? Crear cuenta</button>
          </form>
          )}
        </div>
      </main>
    )
  }

  return children
}
