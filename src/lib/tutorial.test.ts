import { describe, expect, it } from 'vitest'
import { bubblePosition, sameRect, scrollTargetFor } from '../components/TutorialOverlay'
import { shouldStartTutorial } from './tutorial'
import { TUTORIAL_IDS, TUTORIALS, tutorialsForMode, type Tutorial } from './tutorials'

// Código de las pantallas, para comprobar que cada paso señala algo que existe.
const sources = import.meta.glob(['../components/*.tsx', '../App.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const code = Object.values(sources).join('\n')

describe('tutoriales', () => {
  it('sale solo la primera vez, o cuando se pide desde Ayuda', () => {
    const base = { seen: new Set<string>(), loaded: true, active: null, requested: null }
    expect(shouldStartTutorial('menu', base)).toBe(true)
    expect(shouldStartTutorial('menu', { ...base, seen: new Set(['menu']) })).toBe(false)
    expect(shouldStartTutorial('menu', { ...base, loaded: false })).toBe(false)
    expect(shouldStartTutorial('menu', { ...base, active: { id: 'recetas', step: 0 } })).toBe(false)
    expect(shouldStartTutorial('menu', { ...base, seen: new Set(['menu']), requested: 'menu' })).toBe(true)
    expect(shouldStartTutorial('recetas', { ...base, requested: 'menu' })).toBe(false)
  })

  it('cada paso señala una parte que existe en la app', () => {
    for (const id of TUTORIAL_IDS) {
      const tutorial: Tutorial = TUTORIALS[id]
      expect(tutorial.steps.length).toBeGreaterThan(0)
      for (const step of tutorial.steps) {
        if (step.target) expect(code.includes(`data-tour="${step.target}"`) || code.includes(`'${step.target}'`), `${id}: falta data-tour="${step.target}"`).toBe(true)
      }
    }
  })

  it('Ayuda ofrece los del modo del hogar', () => {
    expect(tutorialsForMode('sencillo')).toEqual(['menu-sencillo', 'compra-sencilla', 'ajustes-cuenta', 'ajustes-hogar', 'ajustes-preferencias'])
    expect(tutorialsForMode('completo')).not.toContain('menu-sencillo')
    expect(tutorialsForMode('completo')).toContain('compra-ticket')
  })

  it('el globo va debajo, encima o abajo de la pantalla según quepa', () => {
    expect(bubblePosition({ top: 100, left: 0, width: 100, height: 40 }, 800)).toEqual({ top: 156 })
    expect(bubblePosition({ top: 600, left: 0, width: 100, height: 40 }, 800)).toEqual({ bottom: 216 })
    expect(bubblePosition({ top: 50, left: 0, width: 100, height: 700 }, 800)).toEqual({ bottom: 16 })
    expect(bubblePosition(null, 800)).toEqual({})
  })

  it('desplaza para dejar lo señalado a la vista, sin pasarse', () => {
    // Algo pequeño se centra; algo muy alto se deja arriba (debajo de la barra).
    expect(scrollTargetFor({ top: 900, left: 0, width: 100, height: 100 }, 0, 800, 5000)).toBe(550)
    expect(scrollTargetFor({ top: 900, left: 0, width: 100, height: 600 }, 0, 800, 5000)).toBe(810)
    expect(scrollTargetFor({ top: -50, left: 0, width: 100, height: 40 }, 20, 800, 5000)).toBe(0)
    expect(scrollTargetFor({ top: 900, left: 0, width: 100, height: 100 }, 0, 800, 300)).toBe(300)
  })

  it('el foco solo se redibuja si lo señalado se ha movido de verdad', () => {
    const a = { top: 10, left: 10, width: 100, height: 40 }
    expect(sameRect(a, { ...a, top: 10.3 })).toBe(true)
    expect(sameRect(a, { ...a, top: 12 })).toBe(false)
    expect(sameRect(null, null)).toBe(true)
    expect(sameRect(a, null)).toBe(false)
  })

  it('los nombres de los tutoriales no cambian (si cambiaran, volverían a salir a todos)', () => {
    expect(TUTORIAL_IDS).toEqual(['menu', 'menu-sencillo', 'recetas', 'compra-lista', 'compra-ticket', 'compra-historial', 'compra-sencilla', 'despensa', 'despensa-productos', 'ajustes-cuenta', 'ajustes-hogar', 'ajustes-preferencias'])
  })
})
