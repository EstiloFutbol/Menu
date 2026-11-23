import { Copy, Home, Share2, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { friendlyError } from '../lib/errors'
import type { Household } from '../lib/household'
import { formatInviteCode, inviteLink, inviteShareText, inviteStatus, type AppInvite, type InviteKind } from '../lib/invites'
import { supabase } from '../lib/supabase'

const MAX_ACTIVE = 5
const card = 'rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm'
const buttonClass = 'rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50'
const statusLabel = { activa: 'Sin usar', usada: 'Usada', caducada: 'Caducada', anulada: 'Anulada' } as const
const shortDate = (value: string) => new Date(value).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

// Ajustes → Hogar: crear, compartir y anular invitaciones. Al invitar se elige si es
// a tu hogar (compartís todo) o solo a la app (la otra persona tendrá su propio hogar).
export default function InvitesCard({ household }: { household: Household }) {
  const [invites, setInvites] = useState<AppInvite[]>([])
  const [busy, setBusy] = useState<InviteKind | null>(null)
  const canInviteHere = household.role === 'owner'
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).toString()

  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('app_invites').select('code,kind,household_id,created_at,expires_at,revoked_at,used_email,used_at,household:households(name)').order('created_at', { ascending: false }).limit(20)
    if (error) { setNotice({ kind: 'error', text: /app_invites/.test(error.message) ? 'Falta aplicar en Supabase la migración 20261125000200_app_invites.sql.' : friendlyError(error, 'No se pudieron cargar las invitaciones.') }); return }
    setInvites((data ?? []) as unknown as AppInvite[])
  }, [])

  useEffect(() => { void load() }, [load, household.id, household.name])

  const active = invites.filter((invite) => inviteStatus(invite) === 'activa')

  async function create(kind: InviteKind) {
    if (!supabase) return
    setBusy(kind); setNotice(null)
    const { data, error } = await supabase.rpc('create_app_invite', { p_kind: kind })
    setBusy(null)
    if (error) { setNotice({ kind: 'error', text: friendlyError(error, 'No se pudo crear la invitación.') }); return }
    const created = (Array.isArray(data) ? data[0] : data) as AppInvite
    setNotice({ kind: 'ok', text: `Invitación creada: ${formatInviteCode(created.code)}. ${kind === 'household' ? `Quien la use entrará en «${household.name}».` : 'Quien la use tendrá su propio hogar.'} Compártela con quien quieras invitar.` })
    await load()
  }

  async function share(invite: AppInvite) {
    const code = invite.code
    const url = inviteLink(code, appUrl)
    const text = inviteShareText(code, invite.kind === 'household' ? invite.household?.name ?? 'mi hogar' : null)
    try {
      if (navigator.share) { await navigator.share({ title: 'Invitación a Menu', text, url }); return }
      await navigator.clipboard.writeText(`${text}\n${url}`)
      setNotice({ kind: 'ok', text: 'Enlace de invitación copiado. Pégalo en un mensaje.' })
    } catch {
      // Compartir cancelado por el usuario: no es un error.
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(formatInviteCode(code))
      setNotice({ kind: 'ok', text: `Código ${formatInviteCode(code)} copiado.` })
    } catch {
      setNotice({ kind: 'error', text: 'No se pudo copiar. Apunta el código a mano.' })
    }
  }

  async function revoke(code: string) {
    if (!supabase || !window.confirm(`¿Anular la invitación ${formatInviteCode(code)}? Ya no servirá para crear una cuenta.`)) return
    const { error } = await supabase.rpc('revoke_app_invite', { p_code: code })
    if (error) { setNotice({ kind: 'error', text: friendlyError(error, 'No se pudo anular la invitación.') }); return }
    await load()
  }

  return <section className={card}>
    <h2 className="text-base font-semibold">Invitaciones</h2>
    <p className="mt-2 text-sm text-neutral-500">Solo se puede entrar en Menu con una invitación. Cada código sirve para una persona y caduca a los 7 días. Puedes tener {MAX_ACTIVE} sin usar a la vez.</p>
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      <button type="button" onClick={() => void create('household')} disabled={!canInviteHere || busy !== null || active.length >= MAX_ACTIVE} className={`${buttonClass} text-left`}>
        <span className="flex items-center gap-2"><Home size={16} /> {busy === 'household' ? 'Creando…' : 'Invitar a este hogar'}</span>
        <span className="mt-0.5 block text-xs font-normal text-neutral-500">Compartiréis menú, recetas, compra y despensa de «{household.name}».</span>
      </button>
      <button type="button" onClick={() => void create('app')} disabled={busy !== null || active.length >= MAX_ACTIVE} className={`${buttonClass} text-left`}>
        <span className="flex items-center gap-2"><UserPlus size={16} /> {busy === 'app' ? 'Creando…' : 'Invitar solo a la app'}</span>
        <span className="mt-0.5 block text-xs font-normal text-neutral-500">Tendrá su propio hogar y no verá tus datos.</span>
      </button>
    </div>
    {!canInviteHere && <p className="mt-2 text-xs text-neutral-500">Solo el responsable de «{household.name}» puede invitar a este hogar.</p>}
    {active.length >= MAX_ACTIVE && <p className="mt-2 text-xs text-neutral-500">Ya tienes {MAX_ACTIVE} invitaciones sin usar. Anula alguna para crear otra.</p>}
    {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${notice.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{notice.text}</p>}
    {invites.length > 0 && <ul className="mt-4 divide-y divide-neutral-100 rounded-2xl border border-neutral-200">
      {invites.map((invite) => {
        const status = inviteStatus(invite)
        return <li key={invite.code} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 ${status === 'activa' ? '' : 'text-neutral-400'}`}>
          <div className="w-full min-w-0 sm:w-auto sm:flex-1">
            <p className={`whitespace-nowrap font-mono text-base font-semibold tracking-wider ${status === 'activa' ? 'text-neutral-900' : ''}`}>{formatInviteCode(invite.code)}</p>
            <p className="text-xs text-neutral-500">
              {invite.kind === 'household' ? `Al hogar «${invite.household?.name ?? 'del que saliste'}»` : 'Solo a la app'} · {status === 'usada' ? `usada por ${invite.used_email ?? 'alguien'} el ${shortDate(invite.used_at!)}` : status === 'activa' ? `sin usar, caduca el ${shortDate(invite.expires_at)}` : statusLabel[status].toLowerCase()}
            </p>
          </div>
          {status === 'activa' && <div className="flex gap-1">
            <button type="button" onClick={() => void share(invite)} className="flex items-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"><Share2 size={14} /> Compartir</button>
            <button type="button" onClick={() => void copyCode(invite.code)} className="grid h-8 w-8 place-items-center rounded-xl text-neutral-500 hover:bg-neutral-100" aria-label={`Copiar el código ${formatInviteCode(invite.code)}`} title="Copiar código"><Copy size={15} /></button>
            <button type="button" onClick={() => void revoke(invite.code)} className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">Anular</button>
          </div>}
        </li>
      })}
    </ul>}
  </section>
}
