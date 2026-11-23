import { FormEvent, useEffect, useState } from 'react'
import { friendlyError } from '../lib/errors'
import { MEAL_IDS, saveSettings, useSettings, type MealId } from '../lib/settings'
import type { WeekStart } from '../lib/domain'
import { NumberInput } from './NumberInput'
import { backupFileName, buildBackup, countRows, EXPORT_TABLES, type ExportRow, type ExportTables } from '../lib/export'
import { validateNewPassword } from '../lib/password'
import { supabase } from '../lib/supabase'
import ReceiptAliasesCard from './ReceiptAliasesCard'
import HouseholdSettings from './HouseholdSettings'
import { useHouseholds } from '../lib/household'
import { pendingInviteCode } from '../lib/invites'
import changelogText from '../../CHANGELOG.md?raw'
import { formatChangelogDate, parseChangelog } from '../lib/changelog'

const changelog = parseChangelog(changelogText)
const buildDate = new Date(__APP_BUILD_DATE__)
const builtAt = Number.isNaN(buildDate.getTime()) ? '' : buildDate.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

type Tab = 'cuenta' | 'hogar' | 'preferencias'

// Pestaña abierta, para no perderla si la sección se vuelve a montar (por ejemplo al cambiar de hogar).
let lastTab: Tab = 'cuenta'
type Notice = { kind: 'ok' | 'error'; text: string } | null

const PAGE_SIZE = 1000
const TABLE_LABELS: Record<string, string> = {
  ingredients: 'ingredientes', recipes: 'recetas', recipe_ingredients: 'ingredientes de recetas', recipe_steps: 'pasos de recetas',
  menu_entries: 'menú', menu_entry_recipes: 'recetas del menú', menu_entry_products: 'productos del menú',
  pantry_items: 'despensa', shopping_lists: 'listas de la compra', shopping_items: 'artículos de la compra',
  purchases: 'compras', purchase_items: 'artículos comprados', consumption_logs: 'consumos', consumption_ingredients: 'ingredientes consumidos',
  receipt_aliases: 'alias de tickets', user_settings: 'preferencias de la cuenta', household_settings: 'preferencias del hogar',
}

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
  const [updateNotice, setUpdateNotice] = useState<Notice>(null)

  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<string | null>(null)
  const [exportCounts, setExportCounts] = useState<Record<string, number> | null>(null)
  const [exportNotice, setExportNotice] = useState<Notice>(null)

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

  async function exportData() {
    if (!supabase) return
    setExporting(true)
    setExportNotice(null)
    setExportCounts(null)
    try {
      const tables: ExportTables = {}
      for (const name of EXPORT_TABLES) {
        setExportProgress(`Exportando ${TABLE_LABELS[name] ?? name}…`)
        const rows: ExportRow[] = []
        for (let from = 0; ; from += PAGE_SIZE) {
          const { data, error } = await supabase.from(name).select('*').order(name === 'user_settings' ? 'user_id' : name === 'household_settings' ? 'household_id' : 'id').range(from, from + PAGE_SIZE - 1)
          // Tabla de una migración todavía sin aplicar: se exporta vacía en vez de fallar.
          if (error && (error.code === 'PGRST205' || error.code === '42P01')) break
          if (error) throw error
          rows.push(...((data ?? []) as ExportRow[]))
          if (!data || data.length < PAGE_SIZE) break
        }
        tables[name] = rows
      }
      const backup = buildBackup(tables)
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = backupFileName()
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setExportCounts(countRows(backup.tables))
      setExportNotice({ kind: 'ok', text: 'Copia descargada.' })
    } catch (error) {
      setExportNotice({ kind: 'error', text: friendlyError(error, 'No se ha podido exportar los datos.') })
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
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

  // update() solo comprueba si hay versión nueva: hay que esperar a que el service
  // worker nuevo se instale y tome el control antes de recargar, o se recargaría la antigua.
  async function checkUpdates() {
    setUpdating(true)
    setUpdateNotice(null)
    const worker = navigator.serviceWorker
    const registration = await worker?.getRegistration().catch(() => undefined)
    if (!worker || !registration) { window.location.reload(); return }

    const takenOver = new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 10000)
      worker.addEventListener('controllerchange', () => { window.clearTimeout(timer); resolve() }, { once: true })
    })
    try {
      await registration.update()
    } catch {
      setUpdating(false)
      setUpdateNotice({ kind: 'error', text: 'No se ha podido comprobar. Revisa la conexión.' })
      return
    }
    if (!registration.installing && !registration.waiting) {
      setUpdating(false)
      setUpdateNotice({ kind: 'ok', text: 'Ya tienes la última versión.' })
      return
    }
    await takenOver
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
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <label className="block text-sm text-neutral-600">Repite la contraseña
            <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={`${inputClass} mt-1`} />
          </label>
          <button type="submit" disabled={saving} className="rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Cambiar contraseña'}</button>
        </form>
        <NoticeText notice={passwordNotice} />
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">Copia de seguridad</h2>
        <p className="mt-2 text-sm text-neutral-500">Descarga un archivo JSON con todos los datos del hogar que estás viendo. No se sube a ningún sitio.</p>
        <button type="button" onClick={exportData} disabled={exporting} className={`${buttonClass} mt-4`}>{exporting ? 'Exportando…' : 'Descargar mis datos'}</button>
        {exportProgress && <p role="status" className="mt-3 text-sm text-neutral-500">{exportProgress}</p>}
        <NoticeText notice={exportNotice} />
        {exportCounts && (
          <ul className="mt-2 space-y-0.5 text-sm text-neutral-600">
            {Object.entries(exportCounts).map(([name, n]) => <li key={name}>{TABLE_LABELS[name] ?? name}: <span className="font-medium text-neutral-900">{n}</span></li>)}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold">Sobre la app</h2>
        <p className="mt-2 text-sm text-neutral-500">Versión <span className="font-medium text-neutral-900">{__APP_VERSION__}</span>{builtAt && <> · publicada el {builtAt}</>}{__APP_COMMIT__ && <span className="text-neutral-400"> ({__APP_COMMIT__})</span>}</p>
        <button type="button" onClick={checkUpdates} disabled={updating} className={`${buttonClass} mt-4`}>{updating ? 'Buscando…' : 'Buscar actualizaciones'}</button>
        <NoticeText notice={updateNotice} />
        {changelog.length > 0 && <div className="mt-5 border-t border-neutral-100 pt-4">
          <h3 className="text-sm font-semibold text-neutral-900">Novedades de la {changelog[0].version}{changelog[0].date && <span className="font-normal text-neutral-400"> · {formatChangelogDate(changelog[0].date)}</span>}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-600">{changelog[0].changes.map((change) => <li key={change}>{change}</li>)}</ul>
          {changelog.length > 1 && <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-medium text-neutral-500">Versiones anteriores</summary>
            {changelog.slice(1).map((entry) => <div key={entry.version} className="mt-3">
              <p className="font-medium text-neutral-800">{entry.version}{entry.date && <span className="font-normal text-neutral-400"> · {formatChangelogDate(entry.date)}</span>}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-neutral-600">{entry.changes.map((change) => <li key={change}>{change}</li>)}</ul>
            </div>)}
          </details>}
        </div>}
      </section>
    </div>
  )
}

const MEAL_LABELS: Record<MealId, string> = { desayuno: 'Desayuno', almuerzo: 'Almuerzo', comida: 'Comida', merienda: 'Merienda', cena: 'Cena' }

function PreferencesTab() {
  const { settings, loadError } = useSettings()
  const { current, version } = useHouseholds()
  const [servings, setServings] = useState(String(settings.defaultServings))
  const [weekStartsOn, setWeekStartsOn] = useState<WeekStart>(settings.weekStartsOn)
  const [meals, setMeals] = useState<MealId[]>(settings.visibleMeals)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  // Cuando llegan las preferencias guardadas se reflejan en el formulario.
  useEffect(() => {
    setServings(String(settings.defaultServings))
    setWeekStartsOn(settings.weekStartsOn)
    setMeals(settings.visibleMeals)
  }, [settings])

  const toggleMeal = (id: MealId) => setMeals((current) => {
    if (current.includes(id)) return current.length > 1 ? current.filter((item) => item !== id) : current
    return MEAL_IDS.filter((item) => item === id || current.includes(item))
  })

  async function save(event: FormEvent) {
    event.preventDefault()
    const value = Number(servings)
    if (!Number.isInteger(value) || value < 1 || value > 20) { setNotice({ kind: 'error', text: 'Las raciones deben ser un número entero de 1 a 20.' }); return }
    if (!meals.length) { setNotice({ kind: 'error', text: 'Deja al menos una comida marcada.' }); return }
    setSaving(true)
    setNotice(null)
    try {
      await saveSettings({ defaultServings: value, weekStartsOn, visibleMeals: meals })
      setNotice({ kind: 'ok', text: 'Preferencias guardadas.' })
    } catch (error) {
      setNotice({ kind: 'error', text: friendlyError(error, 'No se han podido guardar las preferencias.') })
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
    <section className={card}>
      <h2 className="text-base font-semibold">Planificación</h2>
      <p className="mt-1 text-sm text-neutral-500">Son del hogar: valen para todas las personas de «{current?.name ?? 'tu hogar'}».</p>
      {loadError && <p role="alert" className="mt-2 text-sm text-red-600">{loadError}</p>}
      <form onSubmit={save} className="mt-3 space-y-4">
        <label className="block text-sm text-neutral-600">Raciones por defecto
          <NumberInput kind="packages" value={servings} onValueChange={setServings} className={`${inputClass} mt-1`} />
        </label>
        <fieldset>
          <legend className="text-sm text-neutral-600">La semana empieza en</legend>
          <div className="mt-1 flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="week-start" checked={weekStartsOn === 1} onChange={() => setWeekStartsOn(1)} /> Lunes</label>
            <label className="flex items-center gap-2"><input type="radio" name="week-start" checked={weekStartsOn === 0} onChange={() => setWeekStartsOn(0)} /> Domingo</label>
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm text-neutral-600">Comidas que se muestran en el menú</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {MEAL_IDS.map((id) => <label key={id} className="flex items-center gap-2"><input type="checkbox" checked={meals.includes(id)} onChange={() => toggleMeal(id)} /> {MEAL_LABELS[id]}</label>)}
          </div>
          <p className="mt-1 text-xs text-neutral-400">Al menos una. Lo ya planificado en comidas ocultas no se borra.</p>
        </fieldset>
        <button type="submit" disabled={saving} className="rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar preferencias'}</button>
      </form>
      <NoticeText notice={notice} />
    </section>
    <ReceiptAliasesCard key={version} />
    </div>
  )
}

function SettingsSection() {
  // Con un enlace de invitación pendiente se abre directamente «Hogar» para unirse.
  const [tab, setTabState] = useState<Tab>(() => (pendingInviteCode() ? 'hogar' : lastTab))
  const setTab = (next: Tab) => { lastTab = next; setTabState(next) }
  const tabs: Array<{ id: Tab; label: string }> = [{ id: 'cuenta', label: 'Cuenta' }, { id: 'hogar', label: 'Hogar' }, { id: 'preferencias', label: 'Preferencias' }]

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
      <div role="tablist" aria-label="Secciones de ajustes" className="mt-4 flex gap-1 rounded-2xl border border-neutral-200 bg-white p-1">
        {tabs.map(({ id, label }) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${tab === id ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}>{label}</button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'cuenta' ? <AccountTab /> : tab === 'hogar' ? <HouseholdSettings /> : <PreferencesTab />}
      </div>
    </div>
  )
}

export default SettingsSection
