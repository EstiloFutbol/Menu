import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { closeTutorial, goToStep, useTutorialState } from '../lib/tutorial'
import { TUTORIALS, type Tutorial, type TutorialStep } from '../lib/tutorials'

type Rect = { top: number; left: number; width: number; height: number }

const PAD = 6
const BUBBLE_SPACE = 240

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

function TutorialBubble({ tutorial, steps, index }: { tutorial: Tutorial; steps: TutorialStep[]; index: number }) {
  const step = steps[index]
  const [rect, setRect] = useState<Rect | null>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const last = index === steps.length - 1

  // Lleva la parte señalada a la vista y la sigue si la pantalla se mueve o cambia.
  useEffect(() => {
    const element = findTarget(step.target)
    if (element) {
      const box = element.getBoundingClientRect()
      const tall = box.height > window.innerHeight * 0.55
      const offset = tall ? 90 : window.innerHeight / 2 - box.height / 2
      window.scrollTo({ top: Math.max(0, window.scrollY + box.top - offset), behavior: 'smooth' })
    }
    const update = () => {
      const target = findTarget(step.target)
      if (!target) { setRect(null); return }
      const box = target.getBoundingClientRect()
      setRect({ top: box.top, left: box.left, width: box.width, height: box.height })
    }
    update()
    const timer = window.setInterval(update, 150)
    window.addEventListener('resize', update)
    return () => { window.clearInterval(timer); window.removeEventListener('resize', update) }
  }, [step])

  useEffect(() => { nextButton.current?.focus() }, [index])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeTutorial() }
      else if (event.key === 'ArrowRight') { event.preventDefault(); if (last) closeTutorial(); else goToStep(index + 1) }
      else if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); goToStep(index - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, last])

  const position = bubblePosition(rect, typeof window === 'undefined' ? 800 : window.innerHeight)
  const centered = !rect

  return <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="tutorial-title" aria-describedby="tutorial-text">
    {/* Capa que oscurece todo menos lo señalado y no deja tocar la app mientras dura el tutorial. */}
    {rect
      ? <div aria-hidden className="pointer-events-none fixed rounded-2xl ring-2 ring-white transition-all duration-200" style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: '0 0 0 9999px rgba(10, 10, 10, 0.55)' }} />
      : <div aria-hidden className="fixed inset-0 bg-black/55" />}
    <div className="fixed inset-0" onClick={(event) => event.stopPropagation()} />
    <div
      className={`fixed left-1/2 w-[min(380px,calc(100vw-32px))] -translate-x-1/2 rounded-3xl bg-white p-5 shadow-2xl ${centered ? 'top-1/2 -translate-y-1/2' : ''}`}
      style={centered ? undefined : position}
    >
      <p className="text-xs font-medium text-neutral-400">{tutorial.title} · Paso {index + 1} de {steps.length}</p>
      <h2 id="tutorial-title" className="mt-1 text-lg font-semibold tracking-tight text-neutral-950">{step.title}</h2>
      <p id="tutorial-text" className="mt-2 text-sm leading-6 text-neutral-600">{step.text}</p>
      <div className="mt-4 flex items-center gap-1.5">
        <button type="button" onClick={closeTutorial} className="mr-auto whitespace-nowrap rounded-xl px-1.5 py-2 text-sm font-medium text-neutral-500 hover:bg-neutral-100">Saltar tutorial</button>
        {index > 0 && <button type="button" onClick={() => goToStep(index - 1)} className="whitespace-nowrap rounded-xl border border-neutral-200 px-2.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Anterior</button>}
        <button ref={nextButton} type="button" onClick={() => (last ? closeTutorial() : goToStep(index + 1))} className="whitespace-nowrap rounded-xl bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white">{last ? 'Terminar' : 'Siguiente'}</button>
      </div>
      <div className="mt-3 flex justify-center gap-1" aria-hidden>{steps.map((_, dot) => <span key={dot} className={`h-1.5 rounded-full transition-all ${dot === index ? 'w-4 bg-neutral-900' : 'w-1.5 bg-neutral-300'}`} />)}</div>
    </div>
  </div>
}

// Muestra el tutorial activo por encima de toda la app.
export default function TutorialOverlay() {
  const { active } = useTutorialState()
  const tutorial: Tutorial | null = active ? TUTORIALS[active.id] : null
  // Los pasos opcionales se quitan si su parte no está en pantalla al empezar.
  const steps = useMemo(() => tutorial ? tutorial.steps.filter((step) => !step.optional || findTarget(step.target)) : [], [tutorial])
  if (!active || !tutorial || !steps.length) return null
  const index = Math.min(active.step, steps.length - 1)
  return createPortal(<TutorialBubble key={`${active.id}-${index}`} tutorial={tutorial} steps={steps} index={index} />, document.body)
}
