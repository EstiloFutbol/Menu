import { useEffect, useSyncExternalStore } from 'react'
import { friendlyError } from './errors'
import { onAppReturn } from './refresh'
import { loadSettings } from './settings'
import { supabase } from './supabase'

// Hogares: todos los datos de la app son del hogar que se está viendo. Cada cuenta
// tiene su hogar personal (no se puede dejar) y puede unirse a otros con una invitación.

export type HouseholdRole = 'owner' | 'member'

export type Household = {
  id: string
  name: string
  isPersonal: boolean
  role: HouseholdRole
  memberCount: number
  isCurrent: boolean
}

export type HouseholdMember = {
  userId: string
  email: string | null
  role: HouseholdRole
  joinedAt: string
  isMe: boolean
}

type HouseholdRow = { id: string; name: string; is_personal: boolean | null; role: string; member_count: number | null; is_current: boolean | null }
type MemberRow = { user_id: string; email: string | null; role: string; joined_at: string; is_me: boolean | null }

export function householdFromRow(row: HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    isPersonal: Boolean(row.is_personal),
    role: row.role === 'owner' ? 'owner' : 'member',
    memberCount: Number(row.member_count) || 1,
    isCurrent: Boolean(row.is_current),
  }
}

export function memberFromRow(row: MemberRow): HouseholdMember {
  return { userId: row.user_id, email: row.email, role: row.role === 'owner' ? 'owner' : 'member', joinedAt: row.joined_at, isMe: Boolean(row.is_me) }
}

export function currentHousehold(households: Household[]) {
  return households.find((household) => household.isCurrent) ?? households.find((household) => household.isPersonal) ?? null
}

type CopyResult = { products?: number; recipes?: number; purchases?: number; aliases?: number }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// Resumen de lo que se ha llevado al hogar personal al salir de otro.
export function copySummary(result: CopyResult | null | undefined): string {
  const parts = [
    result?.recipes ? plural(result.recipes, 'receta', 'recetas') : '',
    result?.purchases ? plural(result.purchases, 'compra', 'compras') : '',
    result?.products ? plural(result.products, 'producto nuevo', 'productos nuevos') : '',
  ].filter(Boolean)
  if (!parts.length) return 'No había recetas ni compras tuyas que copiar.'
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
  return `Se ha copiado a tu hogar: ${list}.`
}

type State = { households: Household[]; loaded: boolean; error: string; version: number }

let state: State = { households: [], loaded: false, error: '', version: 0 }
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
function setState(next: Partial<State>) { state = { ...state, ...next }; listeners.forEach((listener) => listener()) }

export function loadHouseholds(force = false): Promise<void> {
  if (!supabase) return Promise.resolve()
  if (state.loaded && !force) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    try {
      const { data, error } = await supabase!.rpc('my_households')
      if (error) throw error
      const previous = currentHousehold(state.households)?.id
      const households = ((data ?? []) as HouseholdRow[]).map(householdFromRow)
      const next = currentHousehold(households)?.id
      // Si el hogar que se ve ha cambiado (por ejemplo, te han quitado de uno), se recarga todo.
      const changed = state.loaded && previous !== next
      setState({ households, loaded: true, error: '', version: changed ? state.version + 1 : state.version })
      if (changed) await loadSettings(true)
    } catch (cause) {
      setState({ error: /my_households/.test(String((cause as { message?: string })?.message)) ? 'Falta aplicar en Supabase la migración 20261126000100_household_sharing.sql.' : friendlyError(cause, 'No se pudieron cargar los hogares.') })
    } finally { loading = null }
  })()
  return loading
}

// Tras cambiar de hogar se vuelven a cargar las preferencias y todas las secciones.
async function afterHouseholdChange() {
  await loadHouseholds(true)
  await loadSettings(true)
  setState({ version: state.version + 1 })
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('No hay conexión con la base de datos.')
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data as T
}

export async function switchHousehold(householdId: string) {
  await rpc('switch_household', { p_household_id: householdId })
  await afterHouseholdChange()
}

export async function joinHousehold(code: string) {
  await rpc('join_household', { p_code: code })
  await afterHouseholdChange()
}

export async function leaveHousehold(householdId: string, copy: boolean) {
  const result = await rpc<CopyResult>('leave_household', { p_household_id: householdId, p_copy: copy })
  await afterHouseholdChange()
  return result
}

export async function removeHouseholdMember(householdId: string, userId: string) {
  await rpc('remove_household_member', { p_household_id: householdId, p_user_id: userId })
  await loadHouseholds(true)
}

export async function renameHousehold(householdId: string, name: string) {
  await rpc('rename_household', { p_household_id: householdId, p_name: name })
  await loadHouseholds(true)
}

export async function loadHouseholdMembers(householdId: string) {
  const rows = await rpc<MemberRow[]>('household_member_list', { p_household_id: householdId })
  return (rows ?? []).map(memberFromRow)
}

onAppReturn(() => loadHouseholds(true))
supabase?.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { loading = null; setState({ households: [], loaded: false, error: '' }) } })

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useHouseholds() {
  const current = useSyncExternalStore(subscribe, () => state)
  useEffect(() => { void loadHouseholds() }, [])
  return { ...current, current: currentHousehold(current.households) }
}
