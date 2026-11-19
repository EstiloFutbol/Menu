import { useEffect, useSyncExternalStore } from 'react'
import type { WeekStart } from './domain'
import { friendlyError } from './errors'
import { supabase } from './supabase'

export const MEAL_IDS = ['desayuno', 'almuerzo', 'comida', 'merienda', 'cena'] as const
export type MealId = (typeof MEAL_IDS)[number]

export type UserSettings = {
  defaultServings: number
  weekStartsOn: WeekStart
  visibleMeals: MealId[]
}

export const DEFAULT_SETTINGS: UserSettings = { defaultServings: 2, weekStartsOn: 1, visibleMeals: [...MEAL_IDS] }

type SettingsRow = { default_servings?: unknown; week_starts_on?: unknown; visible_meals?: unknown }

// Convierte la fila de la base de datos; cualquier valor inválido vuelve al valor por defecto.
export function settingsFromRow(row: SettingsRow | null | undefined): UserSettings {
  if (!row) return DEFAULT_SETTINGS
  const servings = Number(row.default_servings)
  const visible = Array.isArray(row.visible_meals) ? MEAL_IDS.filter((id) => (row.visible_meals as unknown[]).includes(id)) : []
  return {
    defaultServings: Number.isInteger(servings) && servings >= 1 && servings <= 20 ? servings : DEFAULT_SETTINGS.defaultServings,
    weekStartsOn: row.week_starts_on === 0 ? 0 : 1,
    visibleMeals: visible.length ? visible : [...MEAL_IDS],
  }
}

type State = { settings: UserSettings; loadError: string }

let state: State = { settings: DEFAULT_SETTINGS, loadError: '' }
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
      const { data, error } = await supabase!.from('user_settings').select('default_servings,week_starts_on,visible_meals').maybeSingle()
      if (error) throw error
      loaded = true
      setState({ settings: settingsFromRow(data), loadError: '' })
    } catch (cause) {
      setState({ settings: state.settings, loadError: friendlyError(cause, 'No se han podido cargar las preferencias.') })
    } finally { loading = null }
  })()
  return loading
}

export async function saveSettings(next: UserSettings): Promise<void> {
  if (!supabase) return
  const { data: sessionData } = await supabase.auth.getSession()
  const userId = sessionData.session?.user.id
  if (!userId) throw new Error('No hay sesión iniciada.')
  const { error } = await supabase.from('user_settings').upsert({
    user_id: userId,
    default_servings: next.defaultServings,
    week_starts_on: next.weekStartsOn,
    visible_meals: next.visibleMeals,
  })
  if (error) throw error
  loaded = true
  setState({ settings: next, loadError: '' })
}

function resetSettings() { loaded = false; loading = null; setState({ settings: DEFAULT_SETTINGS, loadError: '' }) }
supabase?.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') resetSettings() })

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useSettings() {
  const current = useSyncExternalStore(subscribe, () => state)
  useEffect(() => { void loadSettings() }, [])
  return current
}
