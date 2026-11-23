import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { TUTORIALS, type Tutorial, type TutorialId, type TutorialSection } from './tutorials'

// Tutoriales: cada pestaña tiene el suyo y sale solo la primera vez que entras.
// Al terminarlo o saltarlo se apunta en la cuenta y no vuelve a salir (en ningún
// dispositivo). Desde Ajustes → Preferencias → Ayuda se puede ver de nuevo.

type State = {
  seen: Set<string>
  loaded: boolean
  // Tutorial que se está viendo y en qué paso.
  active: { id: TutorialId; step: number } | null
  // Pedido desde Ayuda: la app va a su pestaña y lo empieza allí.
  requested: TutorialId | null
}

let state: State = { seen: new Set(), loaded: false, active: null, requested: null }
const listeners = new Set<() => void>()
function setState(next: Partial<State>) { state = { ...state, ...next }; listeners.forEach((listener) => listener()) }
let loading: Promise<void> | null = null

export function loadTutorialsSeen(): Promise<void> {
  if (!supabase || state.loaded) return Promise.resolve()
  if (loading) return loading
  loading = (async () => {
    const { data, error } = await supabase!.from('user_settings').select('tutorials_seen').maybeSingle()
    // Sin la migración no se puede recordar nada: mejor no enseñarlos solos que enseñarlos siempre.
    if (error) setState({ seen: new Set(Object.keys(TUTORIALS)), loaded: true })
    else setState({ seen: new Set(((data as { tutorials_seen?: string[] } | null)?.tutorials_seen) ?? []), loaded: true })
    loading = null
  })()
  return loading
}

function markSeen(id: TutorialId) {
  if (state.seen.has(id)) return
  setState({ seen: new Set([...state.seen, id]) })
  void supabase?.rpc('mark_tutorial_seen', { p_tutorial: id })
}

export function startTutorial(id: TutorialId) {
  setState({ active: { id, step: 0 }, requested: null })
}

export function goToStep(step: number) {
  if (!state.active) return
  setState({ active: { ...state.active, step } })
}

// Terminar y saltar hacen lo mismo: no vuelve a salir solo en esa pestaña.
export function closeTutorial() {
  if (state.active) markSeen(state.active.id)
  setState({ active: null })
}

export function requestTutorial(id: TutorialId) {
  setState({ requested: id })
}

export async function resetTutorials() {
  if (!supabase) return
  const { error } = await supabase.rpc('reset_tutorials')
  if (error) throw error
  setState({ seen: new Set() })
}

// Decide si una pestaña debe empezar su tutorial (separado para poder probarlo).
export function shouldStartTutorial(id: TutorialId, current: Pick<State, 'seen' | 'loaded' | 'active' | 'requested'>) {
  if (current.active) return false
  if (current.requested) return current.requested === id
  return current.loaded && !current.seen.has(id)
}

supabase?.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') { loading = null; setState({ seen: new Set(), loaded: false, active: null, requested: null }) }
})

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function useTutorialState() {
  const current = useSyncExternalStore(subscribe, () => state)
  useEffect(() => { void loadTutorialsSeen() }, [])
  return current
}

// Para cada pestaña: empieza su tutorial la primera vez (o si se ha pedido desde Ayuda).
// Se espera un poco para que la pantalla cargue y el tutorial pueda señalar sus partes.
export const START_DELAY_MS = 900

export function useTutorial(id: TutorialId, ready = true) {
  const current = useTutorialState()
  const start = ready && shouldStartTutorial(id, current)
  useEffect(() => {
    if (!start) return
    const timer = window.setTimeout(() => { if (shouldStartTutorial(id, state)) startTutorial(id) }, START_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [start, id])
}

// Si se ha pedido desde Ayuda un tutorial de esta sección, abre su pestaña.
export function useRequestedTab(section: TutorialSection, setTab: (tab: string) => void) {
  const { requested } = useTutorialState()
  const tab = requested ? (TUTORIALS[requested] as Tutorial).section === section ? (TUTORIALS[requested] as Tutorial).tab : undefined : undefined
  useEffect(() => { if (tab) setTab(tab) }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps
}
