import { useEffect, useRef } from 'react'
import { getLeaveGuard } from './leave-guard'

// Al volver a la app tras un rato fuera se recargan los datos: otra persona del
// hogar (o tú desde otro dispositivo) puede haber cambiado la lista, el menú o la despensa.
// No se recarga si hay cambios sin guardar, para no estorbar.

export const AWAY_MS = 60_000

type Listener = () => unknown
const listeners = new Set<Listener>()
let hiddenAt: number | null = null

// Decide si toca recargar al volver (separado para poder probarlo).
export function shouldRefreshOnReturn(hiddenSince: number | null, now: number, hasUnsavedChanges: boolean) {
  return hiddenSince !== null && now - hiddenSince >= AWAY_MS && !hasUnsavedChanges
}

// Avisa a todas las secciones abiertas y, cuando han terminado, deja la página donde estaba.
export async function refreshAll() {
  const scroll = window.scrollY
  await Promise.allSettled([...listeners].map(async (listener) => listener()))
  window.requestAnimationFrame(() => window.scrollTo({ top: scroll }))
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
    const refresh = shouldRefreshOnReturn(hiddenAt, Date.now(), Boolean(getLeaveGuard()))
    hiddenAt = null
    if (refresh) void refreshAll()
  })
}

export function onAppReturn(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// Vuelve a cargar los datos de la sección al volver a la app.
export function useRefreshOnReturn(reload: Listener) {
  const latest = useRef(reload)
  useEffect(() => { latest.current = reload })
  useEffect(() => onAppReturn(() => latest.current()), [])
}
