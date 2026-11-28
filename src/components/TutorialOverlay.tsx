import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { closeTutorial, goToStep, useTutorialState } from '../lib/tutorial'
import { TUTORIALS, type Tutorial, type TutorialId } from '../lib/tutorials'

type Rect = { top: number; left: number; width: number; height: number }

const PAD = 6
const BUBBLE_SPACE = 240
const DIM = 'rgba(10, 10, 10, 0.55)'
// Duraciones de las animaciones (ms).
const FADE_MS = 180
const MOVE_MS = 320

// Primer elemento visible con ese data-tour (hay partes que existen dos veces: móvil y ordenador).
export function findTarget(name: string | undefined): HTMLElement | null {
  if (!name) return null
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))
  return candidates.find((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 }) ?? null
}

// Dónde va el globo: debajo de lo señalado si cabe; si no, encima; si tampoco, abajo de la pantalla.
export function bubblePosition(rect: Rect | null, viewportHeight: number): { top?: number; bottom?: number } {
  if (!rect) return {}
  const below = viewportHeight - (rect.top + rect.height + PAD)
  const above = rect.top - PAD
  if (below >= BUBBLE_SPACE) return { top: rect.top + rect.height + PAD + 10 }
  if (above >= BUBBLE_SPACE) return { bottom: viewportHeight - rect.top + PAD + 10 }
  return { bottom: 16 }
}

// Desplazamiento para que lo señalado quede a la vista: centrado o, si es muy alto, arriba.
export function scrollTargetFor(box: Rect, scrollY: number, viewportHeight: number, maxScroll: number) {
  const tall = box.height > viewportHeight * 0.55
  const offset = tall ? 90 : viewportHeight / 2 - box.height / 2
  return Math.min(maxScroll, Math.max(0, Math.round(scrollY + box.top - offset)))
}

// ¿Ha cambiado de sitio lo señalado? (medio píxel de margen para no redibujar sin motivo)
export function sameRect(a: Rect | null, b: Rect | null) {
  if (!a || !b) return a === b
  return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const measure = (element: HTMLElement): Rect => { const box = element.getBoundingClientRect(); return { top: box.top, left: box.left, width: box.width, height: box.height } }

// Espera a que exista lo señalado (la pantalla puede estar terminando de cargar).
async function waitForTarget(name: string | undefined, maxMs: number) {
  if (!name) return null
  const start = performance.now()
  while (performance.now() - start < maxMs) {
    const element = findTarget(name)
    if (element) return element
    await nextFrame()
  }
  return null
}

// Espera a que la pantalla deje de moverse (desplazamiento terminado y nada cambiando de sitio).
async function waitUntilStill(read: () => string, maxMs: number) {
  const start = performance.now()
  let last = ''
  let still = 0
  while (performance.now() - start < maxMs) {
    await nextFrame()
    const value = read()
    if (value === last) { if (++still >= 4) return } else { still = 0; last = value }
  }
}

// Muestra el tutorial activo por encima de toda la app.
// Para que se vea fluido: el globo desaparece suavemente, la pantalla se desplaza hasta lo
// siguiente y, cuando ya está quieta, el foco se desliza hasta allí y el globo aparece en su
// sitio. Así nada aparece primero en una esquina ni salta de posición.
export default function TutorialOverlay() {
  const { active } = useTutorialState()
  const reduceMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])

  // Se conserva un momento al cerrarlo, para que desaparezca poco a poco.
  const [shownId, setShownId] = useState<TutorialId | null>(active?.id ?? null)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (active) { setShownId(active.id); setLeaving(false); return }
    setLeaving(true)
    const timer = window.setTimeout(() => { setShownId(null); setLeaving(false) }, reduceMotion ? 0 : FADE_MS)
    return () => window.clearTimeout(timer)
  }, [active, reduceMotion])

  const tutorial: Tutorial | null = shownId ? TUTORIALS[shownId] : null
  // Los pasos opcionales se quitan si su parte no está en pantalla al empezar.
  const steps = useMemo(() => tutorial ? tutorial.steps.filter((step) => !step.optional || findTarget(step.target)) : [], [tutorial])
  const index = active ? Math.min(active.step, Math.max(steps.length - 1, 0)) : 0

  const [rect, setRect] = useState<Rect | null>(null)
  const [visibleIndex, setVisibleIndex] = useState<number | null>(null)
  const [moving, setMoving] = useState(false)
  const [animate, setAnimate] = useState(false)
  const target = useRef<HTMLElement | null>(null)
  const rectRef = useRef<Rect | null>(null)
  const nextButton = useRef<HTMLButtonElement>(null)

  // Al empezar otro tutorial se parte de cero.
  useEffect(() => { setVisibleIndex(null); setRect(null); rectRef.current = null; target.current = null }, [shownId])

  // Cambio de paso: esconder el globo, llevar lo señalado a la vista y, quieto ya, enseñarlo.
  useEffect(() => {
    if (!active || !steps.length) return
    let cancelled = false
    const step = steps[index]
    const wasShowing = visibleIndex !== null
    setMoving(true)
    void (async () => {
      if (wasShowing && !reduceMotion) await sleep(FADE_MS)
      const element = await waitForTarget(step.target, 1500)
      if (cancelled) return
      if (element) {
        const box = measure(element)
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight
        const top = scrollTargetFor(box, window.scrollY, window.innerHeight, maxScroll)
        if (Math.abs(top - window.scrollY) > 4) window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' })
        await waitUntilStill(() => `${Math.round(window.scrollY)}|${JSON.stringify(measure(element))}`, 1500)
        if (cancelled) return
      }
      target.current = element
      const next = element ? measure(element) : null
      // El foco se desliza desde lo anterior; la primera vez aparece ya en su sitio.
      setAnimate(wasShowing && !reduceMotion)
      rectRef.current = next
      setRect(next)
      setVisibleIndex(index)
      setMoving(false)
      if (wasShowing && !reduceMotion) window.setTimeout(() => { if (!cancelled) setAnimate(false) }, MOVE_MS)
    })()
    return () => { cancelled = true }
  }, [active?.id, index, steps]) // eslint-disable-line react-hooks/exhaustive-deps

  // Si la pantalla se mueve con el paso ya a la vista, el foco la sigue en cada fotograma.
  useEffect(() => {
    if (!shownId) return
    let frame = 0
    const follow = () => {
      if (target.current) {
        const next = measure(target.current)
        if (!sameRect(next, rectRef.current)) { rectRef.current = next; setRect(next) }
      }
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(frame)
  }, [shownId])

  const showing = visibleIndex !== null && !moving && !leaving
  useEffect(() => { if (showing) nextButton.current?.focus({ preventScroll: true }) }, [showing, visibleIndex])

  const last = index === steps.length - 1
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeTutorial() }
      else if (event.key === 'ArrowRight') { event.preventDefault(); if (last) closeTutorial(); else goToStep(index + 1) }
      else if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); goToStep(index - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, index, last])

  if (!tutorial || !steps.length) return null

  const viewportWidth = typeof window === 'undefined' ? 400 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  // Sin nada que señalar, el «agujero» se cierra en el centro y todo queda oscurecido.
  const hole = rect
    ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
    : { top: viewportHeight / 2, left: viewportWidth / 2, width: 0, height: 0 }
  const position = bubblePosition(rect, viewportHeight)
  const shownStep = steps[visibleIndex ?? index]
  const overlayVisible = visibleIndex !== null && !leaving
  const fade = reduceMotion ? 'none' : `opacity ${FADE_MS}ms ease`
  const slide = reduceMotion ? 'none' : `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`

  return createPortal(<div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="tutorial-title" aria-describedby="tutorial-text"
    style={{ opacity: overlayVisible ? 1 : 0, transition: fade }}>
    {/* Oscurece todo menos lo señalado; no deja tocar la app mientras dura el tutorial. */}
    <div aria-hidden className="pointer-events-none fixed rounded-2xl" style={{
      ...hole,
      boxShadow: `${rect ? '0 0 0 2px #fff, ' : ''}0 0 0 9999px ${DIM}`,
      transition: animate ? `top ${MOVE_MS}ms ease, left ${MOVE_MS}ms ease, width ${MOVE_MS}ms ease, height ${MOVE_MS}ms ease` : 'none',
    }} />
    <div className="fixed inset-0" onClick={(event) => event.stopPropagation()} />
    {/* El sitio del globo cambia sin animación (mientras está escondido); solo se anima
        su aparición, para que no se vea viajar por la pantalla. */}
    <div
      className="fixed left-1/2 w-[min(380px,calc(100vw-32px))]"
      style={{ ...(rect ? position : { top: '50%' }), transform: rect ? 'translateX(-50%)' : 'translate(-50%, -50%)', pointerEvents: showing ? 'auto' : 'none' }}
    >
    <div className="rounded-3xl bg-white p-5 shadow-2xl" style={{ opacity: showing ? 1 : 0, transform: `translateY(${showing ? 0 : 6}px)`, transition: slide }}>
      <p className="text-xs font-medium text-neutral-400">{tutorial.title} · Paso {(visibleIndex ?? index) + 1} de {steps.length}</p>
      <h2 id="tutorial-title" className="mt-1 text-lg font-semibold tracking-tight text-neutral-950">{shownStep.title}</h2>
      <p id="tutorial-text" className="mt-2 text-sm leading-6 text-neutral-600">{shownStep.text}</p>
      <div className="mt-4 flex items-center gap-1.5">
        <button type="button" onClick={closeTutorial} className="mr-auto whitespace-nowrap rounded-xl px-1.5 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-100">Saltar tutorial</button>
        {(visibleIndex ?? index) > 0 && <button type="button" onClick={() => goToStep(index - 1)} className="whitespace-nowrap rounded-xl border border-neutral-200 px-2.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Anterior</button>}
        <button ref={nextButton} type="button" onClick={() => (last ? closeTutorial() : goToStep(index + 1))} className="whitespace-nowrap rounded-xl bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white">{(visibleIndex ?? index) === steps.length - 1 ? 'Terminar' : 'Siguiente'}</button>
      </div>
      <div className="mt-3 flex justify-center gap-1" aria-hidden>{steps.map((_, dot) => <span key={dot} className={`h-1.5 rounded-full transition-all ${dot === (visibleIndex ?? index) ? 'w-4 bg-neutral-900' : 'w-1.5 bg-neutral-300'}`} />)}</div>
    </div>
    </div>
  </div>, document.body)
}
