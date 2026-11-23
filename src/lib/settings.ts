import { useEffect, useSyncExternalStore } from 'react'
import type { WeekStart } from './domain'
import { friendlyError } from './errors'
import { supabase } from './supabase'

export const MEAL_IDS = ['desayuno', 'almuerzo', 'comida', 'merienda', 'cena'] as const
export type MealId = (typeof MEAL_IDS)[number]

// Modo de la app, del hogar: 'completo' (recetas, despensa, tickets…) o 'sencillo'
// (un texto por día y una lista escrita a mano). Solo cambia qué se muestra.
export type AppMode = 'completo' | 'sencillo'

export type UserSettings = {
  defaultServings: number
  weekStartsOn: WeekStart
  visibleMeals: MealId[]
  mode: AppMode
}

export const DEFAULT_SETTINGS: UserSettings = { defaultServings: 2, weekStartsOn: 1, visibleMeals: [...MEAL_IDS], mode: 'completo' }

type SettingsRow = { default_servings?: unknown; week_starts_on?: unknown; visible_meals?: unknown; mode?: unknown }

// Convierte la fila de la base de datos; cualquier valor inválido vuelve al valor por defecto.
export function settingsFromRow(row: SettingsRow | null | undefined): UserSettings {
  if (!row) return DEFAULT_SETTINGS
  const servings = Number(row.default_servings)
  const visible = Array.isArray(row.visible_meals) ? MEAL_IDS.filter((id) => (row.visible_meals as unknown[]).includes(id)) : []
  return {
    defaultServings: Number.isInteger(servings) && servings >= 1 && servings <= 20 ? servings : DEFAULT_SETTINGS.defaultServings,
    weekStartsOn: row.week_starts_on === 0 ? 0 : 1,
    visibleMeals: visible.length ? visible : [...MEAL_IDS],
    mode: row.mode === 'sencillo' ? 'sencillo' : 'completo',
  }
}

// ready: ya se ha intentado cargar (para no enseñar un modo y cambiar al otro al momento).
type State = { settings: UserSettings; loadError: string; ready: boolean }

let state: State = { settings: DEFAULT_SETTINGS, loadError: '', ready: false }
let loading: Promise<void> | null = null
let loaded = false
const listeners = new Set<() => void>()

function setState(next: State) { state = next; listeners.forEach((listener) => listener()) }

// Carga las preferencias una sola vez y las comparte. Si falla (por ejemplo, migración sin aplicar)
// se mantienen los valores por defecto y el error solo se muestra en la pestaña Preferencias.
export function loadSettings(force = false): Promise<void> {
  if (!supabase) return Promise.resolve()
  if (loaded && !force) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    try {
      // Las preferencias son del hogar que se está viendo (las políticas solo dejan ver esa fila).
      const { data, error } = await supabase!.from('household_settings').select('*').maybeSingle()
      if (error) throw error
      loaded = true
      setState({ settings: settingsFromRow(data), loadError: '', ready: true })
    } catch (cause) {
      const missing = /household_settings/.test(String((cause as { message?: string })?.message))
      setState({ settings: state.settings, ready: true, loadError: missing ? 'Falta aplicar en Supabase la migración 20261126000100_household_sharing.sql.' : friendlyError(cause, 'No se han podido cargar las preferencias.') })
    } finally { loading = null }
  })()
  return loading
}

async function currentHouseholdId(): Promise<string> {
  const { data, error } = await supabase!.rpc('current_household_id')
  if (error) throw error
  if (!data) throw new Error('No hay sesión iniciada.')
  return data as string
}

// Guarda las preferencias de planificación (el modo se guarda aparte, con saveMode).
export async function saveSettings(next: UserSettings): Promise<void> {
  if (!supabase) return
  const householdId = await currentHouseholdId()
  const { error } = await supabase.from('household_settings').upsert({
    household_id: householdId,
    default_servings: next.defaultServings,
    week_starts_on: next.weekStartsOn,
    visible_meals: next.visibleMeals,
  })
  if (error) throw error
  loaded = true
  setState({ settings: { ...next, mode: state.settings.mode }, loadError: '', ready: true })
}

// Cambia el modo del hogar. Solo cambia esta columna: ningún otro dato se toca.
export async function saveMode(mode: AppMode): Promise<void> {
  if (!supabase) return
  const householdId = await currentHouseholdId()
  const { error } = await supabase.from('household_settings').upsert({ household_id: householdId, mode })
  if (error) throw /mode/.test(error.message) ? new Error('Falta aplicar en Supabase la migración 20261127000100_simple_mode.sql.') : error
  loaded = true
  setState({ settings: { ...state.settings, mode }, loadError: '', ready: true })
}

function resetSettings() { loaded = false; loading = null; setState({ settings: DEFAULT_SETTINGS, loadError: '', ready: false }) }
supabase?.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') resetSettings() })

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useSettings() {
  const current = useSyncExternalStore(subscribe, () => state)
  useEffect(() => { void loadSettings() }, [])
  return current
}
