import { Check, Home, LogOut, Pencil, Users } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { friendlyError } from '../lib/errors'
import {
  copySummary, joinHousehold, leaveHousehold, loadHouseholdMembers, removeHouseholdMember, renameHousehold, switchHousehold,
  useHouseholds, type Household, type HouseholdMember,
} from '../lib/household'
import { clearPendingInviteCode, formatInviteCode, normalizeInviteCode, pendingInviteCode } from '../lib/invites'
import InvitesCard from './InvitesCard'

type Notice = { kind: 'ok' | 'error'; text: string } | null

const card = 'rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm'
const inputClass = 'w-full rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900'
const buttonClass = 'rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50'

function NoticeText({ notice }: { notice: Notice }) {
  if (!notice) return null
  return <p role={notice.kind === 'error' ? 'alert' : 'status'} className={`mt-3 text-sm ${notice.kind === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{notice.text}</p>
}

// Salir de un hogar: siempre se ofrece llevarse una copia de lo suyo antes de confirmar.
function LeaveDialog({ household, onClose, onDone }: { household: Household; onClose: () => void; onDone: (text: string) => void }) {
  const [copy, setCopy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function leave() {
    setSaving(true); setError('')
    try {
      const result = await leaveHousehold(household.id, copy)
      onDone(`Has salido de «${household.name}». Ahora estás en tu hogar personal.${copy ? ` ${copySummary(result)}` : ''}`)
    } catch (cause) {
      setError(friendlyError(cause, 'No se ha podido salir del hogar.'))
      setSaving(false)
    }
  }

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="leave-title" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6">
      <h2 id="leave-title" className="text-lg font-semibold tracking-tight">¿Salir de «{household.name}»?</h2>
      <p className="mt-2 text-sm text-neutral-600">Dejarás de ver sus datos y volverás a tu hogar personal, que sigue tal como lo dejaste. <strong className="font-medium text-neutral-800">No se borra nada</strong>: lo que añadiste se queda en este hogar para los demás.</p>
      <label className="mt-4 flex items-start gap-3 rounded-2xl border border-neutral-200 p-3 text-sm">
        <input type="checkbox" className="mt-0.5" checked={copy} onChange={(event) => setCopy(event.target.checked)} />
        <span><span className="font-medium text-neutral-900">Llevarme una copia a mi hogar personal</span><span className="mt-0.5 block text-neutral-500">Las recetas y compras que añadiste tú, con sus productos (sin repetir los que ya tienes). No cambia tu despensa.</span></span>
      </label>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
        <button type="button" disabled={saving} onClick={() => void leave()} className="rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saliendo…' : 'Salir del hogar'}</button>
        <button type="button" disabled={saving} onClick={onClose} className="rounded-2xl px-4 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 sm:mr-auto">Cancelar</button>
      </div>
    </div>
  </div>
}

function CurrentHouseholdCard({ household, onLeft }: { household: Household; onLeft: (text: string) => void }) {
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [notice, setNotice] = useState<Notice>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(household.name)
  const [saving, setSaving] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const isOwner = household.role === 'owner'

  const load = useCallback(async () => {
    try { setMembers(await loadHouseholdMembers(household.id)) } catch (cause) { setNotice({ kind: 'error', text: friendlyError(cause, 'No se pudieron cargar las personas del hogar.') }) }
  }, [household.id])
  useEffect(() => { void load() }, [load, household.memberCount])
  useEffect(() => { setName(household.name) }, [household.name])

  async function rename(event: FormEvent) {
    event.preventDefault()
    const clean = name.trim()
    if (!clean || clean.length > 80) { setNotice({ kind: 'error', text: 'El nombre debe tener entre 1 y 80 caracteres.' }); return }
    setSaving(true); setNotice(null)
    try { await renameHousehold(household.id, clean); setEditing(false); setNotice({ kind: 'ok', text: 'Nombre cambiado.' }) }
    catch (cause) { setNotice({ kind: 'error', text: friendlyError(cause, 'No se ha podido cambiar el nombre.') }) }
    finally { setSaving(false) }
  }

  async function remove(member: HouseholdMember) {
    const who = member.email ?? 'esta persona'
    if (!window.confirm(`¿Quitar a ${who} de «${household.name}»? No se borra nada de lo que añadió y volverá a su hogar personal.`)) return
    setNotice(null)
    try { await removeHouseholdMember(household.id, member.userId); await load(); setNotice({ kind: 'ok', text: `${who} ya no está en el hogar.` }) }
    catch (cause) { setNotice({ kind: 'error', text: friendlyError(cause, 'No se ha podido quitar a esa persona.') }) }
  }

  return <section data-tour="hogar-actual" className={card}>
    <div className="flex items-start gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-neutral-100 text-neutral-700"><Home size={19} /></div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Estás viendo</p>
        {editing ? <form onSubmit={rename} className="mt-1 flex gap-2">
          <input autoFocus aria-label="Nombre del hogar" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
          <button type="submit" disabled={saving} className="rounded-2xl bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-50">{saving ? '…' : 'Guardar'}</button>
          <button type="button" disabled={saving} onClick={() => { setEditing(false); setName(household.name) }} className="rounded-2xl px-3 text-sm text-neutral-500 hover:bg-neutral-100">Cancelar</button>
        </form> : <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="truncate">{household.name}</span>
          {isOwner && <button type="button" onClick={() => setEditing(true)} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Cambiar el nombre del hogar" title="Cambiar el nombre"><Pencil size={15} /></button>}
        </h2>}
        <p className="mt-1 text-sm text-neutral-500">
          {household.isPersonal ? 'Tu hogar personal. ' : ''}
          {household.memberCount > 1 ? 'Todos los que están aquí ven y cambian lo mismo: menú, recetas, compra, despensa y tickets.' : household.isPersonal ? 'Solo lo ves tú. Invita a alguien para compartirlo.' : 'Ahora mismo solo estás tú.'}
        </p>
      </div>
    </div>

    <h3 className="mt-5 flex items-center gap-2 text-sm font-semibold text-neutral-900"><Users size={15} /> Personas</h3>
    <ul className="mt-2 divide-y divide-neutral-100 rounded-2xl border border-neutral-200">
      {members.map((member) => <li key={member.userId} className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-900">{member.email ?? 'Cuenta borrada'}{member.isMe && <span className="font-normal text-neutral-400"> (tú)</span>}</p>
          <p className="text-xs text-neutral-500">{member.role === 'owner' ? 'Responsable' : 'Miembro'} · desde el {new Date(member.joinedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        </div>
        {isOwner && !member.isMe && <button type="button" onClick={() => void remove(member)} className="rounded-xl px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">Quitar</button>}
      </li>)}
    </ul>
    {isOwner && household.memberCount > 1 && <p className="mt-2 text-xs text-neutral-400">Eres el responsable: puedes invitar, quitar personas y cambiar el nombre.</p>}

    {!household.isPersonal && <button type="button" onClick={() => setLeaving(true)} className={`${buttonClass} mt-4 flex items-center gap-2`}><LogOut size={16} /> Salir del hogar</button>}
    <NoticeText notice={notice} />
    {leaving && <LeaveDialog household={household} onClose={() => setLeaving(false)} onDone={(text) => { setLeaving(false); onLeft(text) }} />}
  </section>
}

function SwitchHouseholdCard({ households, onSwitched }: { households: Household[]; onSwitched: (text: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice>(null)

  async function choose(household: Household) {
    setBusy(household.id); setNotice(null)
    try { await switchHousehold(household.id); onSwitched(`Ahora estás en «${household.name}».`) }
    catch (cause) { setNotice({ kind: 'error', text: friendlyError(cause, 'No se ha podido cambiar de hogar.') }) }
    finally { setBusy(null) }
  }

  return <section className={card}>
    <h2 className="text-base font-semibold">Tus hogares</h2>
    <p className="mt-2 text-sm text-neutral-500">Cambiar de hogar solo cambia lo que ves: sigues en todos y puedes volver cuando quieras.</p>
    <ul className="mt-4 divide-y divide-neutral-100 rounded-2xl border border-neutral-200">
      {households.map((household) => <li key={household.id} className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-neutral-900">{household.name}</p>
          <p className="text-xs text-neutral-500">{household.isPersonal ? 'Tu hogar personal' : household.role === 'owner' ? 'Eres el responsable' : 'Miembro'} · {household.memberCount === 1 ? '1 persona' : `${household.memberCount} personas`}</p>
        </div>
        {household.isCurrent
          ? <span className="flex items-center gap-1 text-xs font-medium text-emerald-700"><Check size={14} /> Lo estás viendo</span>
          : <button type="button" disabled={busy !== null} onClick={() => void choose(household)} className="rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">{busy === household.id ? 'Cambiando…' : 'Ver este hogar'}</button>}
      </li>)}
    </ul>
    <NoticeText notice={notice} />
  </section>
}

function JoinHouseholdCard({ onJoined }: { onJoined: (text: string) => void }) {
  const [code, setCode] = useState(() => formatInviteCode(pendingInviteCode() ?? ''))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  useEffect(() => { clearPendingInviteCode() }, [])

  async function join(event: FormEvent) {
    event.preventDefault()
    const clean = normalizeInviteCode(code)
    if (clean.length !== 8) { setNotice({ kind: 'error', text: 'El código tiene 8 letras y números, por ejemplo K7MQ-2PXA.' }); return }
    setBusy(true); setNotice(null)
    try {
      await joinHousehold(clean)
      setCode('')
      onJoined('Te has unido al hogar y ya lo estás viendo. Tus datos siguen en tu hogar personal: puedes volver a él en «Tus hogares».')
    } catch (cause) {
      setNotice({ kind: 'error', text: friendlyError(cause, 'No te has podido unir al hogar.') })
    } finally { setBusy(false) }
  }

  return <section data-tour="hogar-unirse" className={card}>
    <h2 className="text-base font-semibold">Unirme a un hogar</h2>
    <p className="mt-2 text-sm text-neutral-500">Escribe el código que te ha dado alguien de ese hogar. No pierdes nada: tus datos siguen en tu hogar personal.</p>
    <form onSubmit={join} className="mt-4 flex gap-2">
      <input aria-label="Código de invitación" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="K7MQ-2PXA" className={`${inputClass} font-mono tracking-wider`} />
      <button type="submit" disabled={busy || !code.trim()} className="shrink-0 rounded-2xl bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Uniendo…' : 'Unirme'}</button>
    </form>
    <NoticeText notice={notice} />
  </section>
}

// Ajustes → Hogar.
export default function HouseholdSettings() {
  const { households, current, loaded, error } = useHouseholds()
  const [notice, setNotice] = useState<Notice>(null)

  if (error) return <section className={card}><p role="alert" className="text-sm text-red-600">{error}</p></section>
  if (!loaded || !current) return <section className={`${card} text-sm text-neutral-500`}>Cargando…</section>

  const done = (text: string) => setNotice({ kind: 'ok', text })
  return <div className="space-y-4">
    {notice && <p role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice.text}</p>}
    <CurrentHouseholdCard key={current.id} household={current} onLeft={done} />
    <InvitesCard household={current} />
    {households.length > 1 && <SwitchHouseholdCard households={households} onSwitched={done} />}
    <JoinHouseholdCard onJoined={done} />
  </div>
}
