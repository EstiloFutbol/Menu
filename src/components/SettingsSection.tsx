import { FormEvent, useEffect, useState } from 'react'
import { friendlyError } from '../lib/errors'
import { validateNewPassword } from '../lib/password'
import { supabase } from '../lib/supabase'

type Tab = 'cuenta' | 'ajustes'
type Notice = { kind: 'ok' | 'error'; text: string } | null

const card = 'rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm'
const inputClass = 'w-full rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900'
const buttonClass = 'rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50'

function NoticeText({ notice }: { notice: Notice }) {
  if (!notice) return null
  return <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${notice.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{notice.text}</p>
}

function AccountTab() {
  const [email, setEmail] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [saving, setSaving] = useState(false)
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null)
  const [sessionNotice, setSessionNotice] = useState<Notice>(null)
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    let active = true
    supabase?.auth.getUser().then(({ data }) => { if (active) setEmail(data.user?.email ?? null) })
    return () => { active = false }
  }, [])

  async function signOut(global: boolean) {
    if (!supabase) return
    if (global && !window.confirm('¿Cerrar sesión en todos los dispositivos? Tendrás que volver a iniciar sesión en cada uno.')) return
    setSessionNotice(null)
    const { error } = global ? await supabase.auth.signOut({ scope: 'global' }) : await supabase.auth.signOut()
    if (error) setSessionNotice({ kind: 'error', text: friendlyError(error, 'No se ha podido cerrar la sesión.') })
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    const invalid = validateNewPassword(password, repeat)
    if (invalid) { setPasswordNotice({ kind: 'error', text: invalid }); return }
    setSaving(true)
    setPasswordNotice(null)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) { setPasswordNotice({ kind: 'error', text: friendlyError(error, 'No se ha podido cambiar la contraseña.') }); return }
    setPassword('')
    setRepeat('')
    setPasswordNotice({ kind: 'ok', text: 'Contraseña actualizada correctamente.' })
  }

  async function checkUpdates() {
    setUpdating(true)
    try {
      const registration = await navigator.serviceWorker?.getRegistration()
      await registration?.update()
    } catch { /* si no hay service worker, basta con recargar */ }
    window.location.reload()
  }

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="text-base font-semibold">Sesión</h2>
        <p className="mt-2 text-sm text-neutral-500">Correo: <span className="font-medium text-neutral-900">{email ?? '—'}</span></p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => signOut(false)} className={buttonClass}>Cerrar sesión</button>
          <button type="button" onClick={() => signOut(true)} className={buttonClass}>Cerrar sesión en todos los dispositivos</button>
        </div>
        <NoticeText notice={sessionNotice} />
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">Cambiar contraseña</h2>
        <form onSubmit={changePassword} className="mt-3 space-y-3">
          <label className="block text-sm text-neutral-600">Contraseña nueva
            <input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-sm text-neutral-600">Repite la contraseña
            <input type="password" autoComplete="new-password" minLength={8} value={repeat} onChange={(e) => setRepeat(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <button type="submit" disabled={saving} className="rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Cambiar contraseña'}</button>
        </form>
        <NoticeText notice={passwordNotice} />
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">Sobre la app</h2>
        <p className="mt-2 text-sm text-neutral-500">Versión <span className="font-medium text-neutral-900">{__APP_VERSION__}</span></p>
        <button type="button" onClick={checkUpdates} disabled={updating} className={`${buttonClass} mt-4`}>{updating ? 'Buscando…' : 'Buscar actualizaciones'}</button>
      </section>
    </div>
  )
}

function SettingsSection() {
  const [tab, setTab] = useState<Tab>('cuenta')
  const tabs: Array<{ id: Tab; label: string }> = [{ id: 'cuenta', label: 'Cuenta' }, { id: 'ajustes', label: 'Ajustes' }]

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
      <div role="tablist" aria-label="Secciones de ajustes" className="mt-4 flex gap-1 rounded-2xl border border-neutral-200 bg-white p-1">
        {tabs.map(({ id, label }) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${tab === id ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}>{label}</button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'cuenta' ? <AccountTab /> : <section className={card}><p className="text-sm text-neutral-500">Próximamente</p></section>}
      </div>
    </div>
  )
}

export default SettingsSection
