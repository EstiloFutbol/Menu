import { ChevronLeft, ChevronRight, Copy, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDays, formatWeekRange, localDateString, startOfWeek, weekdayNames } from '../lib/domain'
import { friendlyError } from '../lib/errors'
import { useRefreshOnReturn } from '../lib/refresh'
import { useSettings } from '../lib/settings'
import { describeNotesCopy, plannedDaySummary } from '../lib/simple'
import { supabase } from '../lib/supabase'
import { DayNoteEditor } from './DayNoteEditor'
import { useTutorial } from '../lib/tutorial'

type PlannedEntry = Parameters<typeof plannedDaySummary>[0][number] & { planned_date: string }

const formatDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

// Menú en modo sencillo: un cuadro de texto por día. Debajo, sin poder editarlo, lo
// que haya planificado en el menú completo, para que nunca se oculte nada.
export default function SimpleMenuSection() {
  const { settings } = useSettings()
  const weekStartsOn = settings.weekStartsOn
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), weekStartsOn))
  useEffect(() => { setWeekStart((current) => startOfWeek(addDays(current, 3), weekStartsOn)) }, [weekStartsOn])
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [planned, setPlanned] = useState<PlannedEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState<{ text: string; target?: Date } | null>(null)
  const [copying, setCopying] = useState(false)

  const days = useMemo(() => {
    const labels = weekdayNames(weekStartsOn)
    return Array.from({ length: 7 }, (_, index) => ({ date: localDateString(addDays(weekStart, index)), label: labels[index] }))
  }, [weekStart, weekStartsOn])

  const load = useCallback(async (quiet = false) => {
    if (!supabase) return
    if (!quiet) setLoading(true)
    setError('')
    const from = localDateString(weekStart)
    const to = localDateString(addDays(weekStart, 6))
    const [notesResult, plannedResult] = await Promise.all([
      supabase.from('menu_day_notes').select('day,text').gte('day', from).lte('day', to),
      supabase.from('menu_entries').select('planned_date,is_eating_out,menu_entry_recipes(sort_order,recipe:recipes(name)),menu_entry_products(sort_order,ingredient:ingredients(name))').gte('planned_date', from).lte('planned_date', to),
    ])
    if (notesResult.error) setError(/menu_day_notes/.test(notesResult.error.message) ? 'Falta aplicar en Supabase la migración 20261127000100_simple_mode.sql.' : friendlyError(notesResult.error, 'No se pudo cargar el menú.'))
    else setNotes(Object.fromEntries((notesResult.data ?? []).map((row) => [row.day as string, row.text as string])))
    if (!plannedResult.error) setPlanned((plannedResult.data ?? []) as unknown as PlannedEntry[])
    setLoading(false)
  }, [weekStart])

  useEffect(() => { void load() }, [load])
  useRefreshOnReturn(() => load(true))
  useTutorial('menu-sencillo', !loading)

  async function copyToNextWeek() {
    if (!supabase) return
    const target = addDays(weekStart, 7)
    setCopying(true); setMessage(null); setError('')
    // Lo que se esté escribiendo se guarda al salir del cuadro (al pulsar el botón).
    await new Promise((resolve) => window.setTimeout(resolve, 300))
    const { data, error: copyError } = await supabase.rpc('copy_day_notes', { p_from_week: localDateString(weekStart), p_to_week: localDateString(target) })
    setCopying(false)
    if (copyError) { setError(friendlyError(copyError, 'No se pudo copiar la semana.')); return }
    setMessage({ text: `Semana copiada a la siguiente (${formatWeekRange(target)}). ${describeNotesCopy(data as { copied: number; kept: number })}`, target })
  }

  const hasText = Object.values(notes).some((text) => text.trim())
  const today = localDateString(new Date())
  // El ejemplo de qué escribir solo se enseña en un día (hoy, o el primero de la semana).
  const exampleDay = days.some((day) => day.date === today) ? today : days[0]?.date

  return <div className="space-y-5">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm font-medium text-neutral-500">Menú de la semana</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">Tu menú</h1>
        <p className="mt-2 text-sm text-neutral-500">{formatWeekRange(weekStart)}</p>
      </div>
      <div data-tour="menu-semana" className="flex flex-wrap gap-2">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm" aria-label="Semana anterior"><ChevronLeft size={18} /></button>
        <button onClick={() => setWeekStart(startOfWeek(new Date(), weekStartsOn))} className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm">Esta semana</button>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm" aria-label="Semana siguiente"><ChevronRight size={18} /></button>
        <button onClick={() => void copyToNextWeek()} disabled={copying || !hasText} title={hasText ? 'Copiar lo escrito a la semana siguiente' : 'No hay nada escrito esta semana'} className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm disabled:opacity-40"><Copy size={16} /> {copying ? 'Copiando…' : 'Copiar a la siguiente'}</button>
      </div>
    </header>

    {message && <div className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
      <span>{message.text} {message.target && <button type="button" onClick={() => { setWeekStart(message.target!); setMessage(null) }} className="font-medium underline underline-offset-2">Ver esa semana</button>}</span>
      <button onClick={() => setMessage(null)} className="shrink-0 text-emerald-700" aria-label="Cerrar aviso"><X size={16} /></button>
    </div>}
    {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    {loading ? <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-sm text-neutral-500 shadow-sm">Cargando menú…</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {days.map((day) => {
        const summary = plannedDaySummary(planned.filter((entry) => entry.planned_date === day.date))
        const isToday = day.date === today
        return <section key={day.date} data-tour={day.date === exampleDay ? 'menu-dia' : undefined} className={`rounded-3xl border bg-white p-4 shadow-sm ${isToday ? 'border-neutral-900' : 'border-neutral-200'}`}>
          <h2 className="flex items-baseline gap-2 text-sm font-semibold text-neutral-900">{day.label}<span className="text-xs font-normal text-neutral-400">{formatDay(day.date)}{isToday ? ' · Hoy' : ''}</span></h2>
          <div className="mt-2">
            <DayNoteEditor key={day.date} day={day.date} serverText={notes[day.date] ?? ''} label={`Menú del ${day.label.toLowerCase()} ${formatDay(day.date)}`} placeholder={day.date === exampleDay ? 'Comida: lentejas y fruta. Cena: tortilla.' : undefined} onSaved={(date, text) => setNotes((current) => ({ ...current, [date]: text }))} />
          </div>
          {summary && <p className="mt-2 text-xs text-neutral-500"><span className="font-medium">En el menú completo:</span> {summary}</p>}
        </section>
      })}
    </div>}
  </div>
}
