import { loadHouseholds } from './household'
import { refreshForRemoteChange } from './refresh'
import { loadSettings } from './settings'
import { supabase } from './supabase'

// Cambios en vivo del hogar (Supabase Realtime). Cuando alguien del hogar cambia la
// lista, el menú, la despensa… la app recarga lo que estás viendo, sin «Cargando…».
// Supabase solo envía a cada persona los cambios de filas que puede ver (las de su hogar).

// Tablas con household_id: se escuchan solo las del hogar actual.
export const HOUSEHOLD_TABLES = [
  'shopping_lists', 'quick_list_items', 'menu_entries', 'menu_day_notes', 'consumption_logs',
  'pantry_items', 'ingredients', 'recipes', 'purchases',
] as const
// Filas de detalle (sin household_id): la seguridad ya filtra las de otros hogares.
export const DETAIL_TABLES = ['shopping_items', 'menu_entry_recipes', 'menu_entry_products'] as const

export const REMOTE_DEBOUNCE_MS = 700

// Junta los cambios que llegan seguidos (guardar una comida cambia varias tablas) en una sola recarga.
export function debounce(run: () => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | null = null
  const trigger = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; run() }, wait)
  }
  trigger.cancel = () => { if (timer) clearTimeout(timer); timer = null }
  return trigger
}

// Empieza a escuchar los cambios del hogar. Devuelve la función para dejar de escuchar.
export function listenToHousehold(householdId: string): () => void {
  if (!supabase) return () => {}
  const client = supabase
  const refresh = debounce(refreshForRemoteChange, REMOTE_DEBOUNCE_MS)
  const reloadSettings = debounce(() => { void loadSettings(true) }, REMOTE_DEBOUNCE_MS)
  const reloadHouseholds = debounce(() => { void loadHouseholds(true) }, REMOTE_DEBOUNCE_MS)

  let channel = client.channel(`hogar-${householdId}`)
  for (const table of HOUSEHOLD_TABLES) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` }, refresh)
  }
  for (const table of DETAIL_TABLES) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
  }
  // El modo y las preferencias del hogar; quién está en él y su nombre.
  channel = channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'household_settings', filter: `household_id=eq.${householdId}` }, reloadSettings)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'household_members', filter: `household_id=eq.${householdId}` }, reloadHouseholds)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${householdId}` }, reloadHouseholds)
  channel.subscribe()

  return () => {
    refresh.cancel(); reloadSettings.cancel(); reloadHouseholds.cancel()
    void client.removeChannel(channel)
  }
}
