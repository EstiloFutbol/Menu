import { useEffect, useRef } from 'react'
import { getLeaveGuard } from './leave-guard'

// Recarga de lo que se está viendo cuando otra persona del hogar (o tú desde otro
// dispositivo) cambia algo: al momento con los cambios en vivo (realtime.ts) y,
// por si acaso, al volver a la app tras un rato fuera.
// No se recarga si hay cambios sin guardar, para no estorbar.

export const AWAY_MS = 60_000

type Listener = () => unknown
const listeners = new Set<Listener>()
let hiddenAt: number | null = null
// Llegó un cambio de otra persona con la app en segundo plano: se recarga al volver.
let staleWhileHidden = false
// Mientras dura, las secciones recargan sin enseñar «Cargando…» (sin parpadeo).
let quiet = false

// Para las funciones que cargan datos: en una recarga silenciosa no se pone «Cargando…».
export function isQuietRefresh() { return quiet }

// Decide si toca recargar al volver (separado para poder probarlo).
export function shouldRefreshOnReturn(hiddenSince: number | null, now: number, hasUnsavedChanges: boolean) {
  return hiddenSince !== null && now - hiddenSince >= AWAY_MS && !hasUnsavedChanges
}

// Avisa a todas las secciones abiertas y, cuando han terminado, deja la página donde estaba.
// Las cargas empiezan dentro del bloque silencioso, así que no enseñan «Cargando…».
export async function refreshAll() {
  const scroll = window.scrollY
  quiet = true
  let running: Promise<unknown>[]
  try { running = [...listeners].map(callSafely) } finally { quiet = false }
  await Promise.allSettled(running)
  window.requestAnimationFrame(() => window.scrollTo({ top: scroll }))
}

function callSafely(listener: Listener): Promise<unknown> {
  try { return Promise.resolve(listener()) } catch (error) { return Promise.reject(error) }
}

// Un cambio hecho por otra persona: recarga lo que se ve, salvo si estás editando algo
// sin guardar (no se te cambia nada debajo) o si la app está en segundo plano (se hará al volver).
export function refreshForRemoteChange() {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') { staleWhileHidden = true; return }
  if (getLeaveGuard()) return
  void refreshAll()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
    const refresh = (staleWhileHidden && !getLeaveGuard()) || shouldRefreshOnReturn(hiddenAt, Date.now(), Boolean(getLeaveGuard()))
    hiddenAt = null
    staleWhileHidden = false
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
