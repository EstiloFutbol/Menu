import { CalendarDays, ChefHat, Home, PackageOpen, Settings, ShoppingBasket } from 'lucide-react'
import { useEffect, useState } from 'react'
import MenuSection from './components/MenuSection'
import PantrySection from './components/PantrySection'
import PurchaseAreaSection from './components/PurchaseAreaSection'
import RecipesSection from './components/RecipesSection'
import SettingsSection from './components/SettingsSection'
import type { PantryNotice } from './lib/pantry-notice'
import { getLeaveGuard, setLeaveGuard, type LeaveGuard } from './lib/leave-guard'
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog'
import { useHouseholds } from './lib/household'
import { listenToHousehold } from './lib/realtime'
import { pendingInviteCode } from './lib/invites'
import { useSettings } from './lib/settings'
import SimpleMenuSection from './components/SimpleMenuSection'
import SimpleShoppingSection from './components/SimpleShoppingSection'

type Section = 'menu' | 'recetas' | 'compra' | 'despensa' | 'ajustes'

const allSections: Array<{ id: Section; label: string; icon: typeof CalendarDays }> = [
  { id: 'menu', label: 'Menú', icon: CalendarDays },
  { id: 'recetas', label: 'Recetas', icon: ChefHat },
  { id: 'compra', label: 'Compra', icon: ShoppingBasket },
  { id: 'despensa', label: 'Despensa', icon: PackageOpen },
  { id: 'ajustes', label: 'Ajustes', icon: Settings },
]

// En modo sencillo solo hay Menú, Compra y Ajustes. Lo demás sigue guardado, sin tocar.
const SIMPLE_SECTIONS: Section[] = ['menu', 'compra', 'ajustes']

function App() {
  // Con un enlace de invitación pendiente se abre Ajustes → Hogar para unirse.
  const [section, setSectionState] = useState<Section>(() => (pendingInviteCode() ? 'ajustes' : 'menu'))
  // Al cambiar de hogar cambia `version` y las secciones se vuelven a cargar con sus datos.
  const { current, households, version } = useHouseholds()
  const { settings, ready } = useSettings()
  // Cambios en vivo: lo que cambie otra persona del hogar aparece al momento.
  const currentId = current?.id
  useEffect(() => (currentId ? listenToHousehold(currentId) : undefined), [currentId])
  const simple = settings.mode === 'sencillo'
  const sections = simple ? allSections.filter(({ id }) => SIMPLE_SECTIONS.includes(id)) : allSections
  // Si se cambia a modo sencillo estando en una sección que no existe en él, se ve el menú.
  const shown: Section = sections.some(({ id }) => id === section) ? section : 'menu'
  // Aviso para la despensa tras importar un ticket; se quita al cambiar de sección.
  const [pantryNotice, setPantryNotice] = useState<PantryNotice | null>(null)

  // Sección a la que se quiere ir mientras se pregunta por cambios sin guardar.
  const [pendingLeave, setPendingLeave] = useState<{ section: Section; guard: LeaveGuard } | null>(null)

  function goToSection(next: Section) {
    setPantryNotice(null)
    setSectionState(next)
    window.scrollTo({ top: 0 })
  }

  function setSection(next: Section) {
    const guard = getLeaveGuard()
    if (guard && next !== shown) { setPendingLeave({ section: next, guard }); return }
    goToSection(next)
  }

  function showImportedInPantry(notice: PantryNotice) {
    setSectionState('despensa')
    setPantryNotice(notice)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-neutral-900">
      {/* En el móvil la navegación va arriba: abajo la recortaban la barra de gestos y las esquinas de la pantalla. */}
      {pendingLeave && <UnsavedChangesDialog guard={pendingLeave.guard} onStay={() => setPendingLeave(null)} onLeave={() => { setLeaveGuard(null); const next = pendingLeave.section; setPendingLeave(null); goToSection(next) }} />}
      <nav className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 px-1 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] backdrop-blur lg:hidden">
        <div className={`mx-auto grid max-w-md gap-0.5 ${simple ? 'grid-cols-3' : 'grid-cols-5'}`}>
          {sections.map(({ id, label, icon: Icon }) => { const active = shown === id; return <button key={id} onClick={() => setSection(id)} aria-current={active ? 'page' : undefined} className={`flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 text-[10.5px] font-medium tracking-tight ${active ? 'bg-neutral-900 text-white' : 'text-neutral-500'}`}><Icon size={18} strokeWidth={1.8} />{label}</button> })}
        </div>
      </nav>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-neutral-200 px-5 py-7 lg:block">
          <div className="px-2">
            <p className="text-xl font-semibold tracking-tight">Menu</p>
            <p className="mt-1 truncate text-xs text-neutral-400" title={current?.name}>{current && (households.length > 1 || current.memberCount > 1) ? current.name : 'Planificación personal'}</p>
          </div>
          <nav className="mt-8 space-y-1">
            {sections.map(({ id, label, icon: Icon }) => {
              const active = shown === id
              return <button key={id} onClick={() => setSection(id)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-white'}`}><Icon size={18} strokeWidth={1.8} />{label}</button>
            })}
          </nav>
        </aside>
        {/* Ocupa todo el ancho disponible; solo en pantallas muy anchas se limita para que no se estire de más. */}
        <main className="min-w-0 flex-1 px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-9">
          <div className="mx-auto w-full max-w-[1800px]">
            {/* En el móvil no hay barra lateral: si tiene varios hogares, se indica cuál está viendo. */}
            {current && households.length > 1 && shown !== 'ajustes' && <button type="button" onClick={() => setSection('ajustes')} className="mb-3 flex max-w-full items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600 lg:hidden"><Home size={13} /><span className="truncate">{current.name}</span></button>}
            {/* Hasta saber el modo del hogar no se enseña nada, para no mostrar un modo y cambiar al otro. */}
            {!ready && shown !== 'ajustes' ? <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-sm text-neutral-500 shadow-sm">Cargando…</div> : <>
              {shown === 'menu' && (simple ? <SimpleMenuSection key={version} /> : <MenuSection key={version} />)}
              {shown === 'recetas' && <RecipesSection key={version} />}
              {shown === 'compra' && (simple ? <SimpleShoppingSection key={version} /> : <PurchaseAreaSection key={version} onReceiptImported={showImportedInPantry} />)}
              {shown === 'despensa' && <PantrySection key={version} notice={pantryNotice} onDismissNotice={() => setPantryNotice(null)} />}
              {shown === 'ajustes' && <SettingsSection />}
            </>}
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
