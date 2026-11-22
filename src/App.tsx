import { CalendarDays, ChefHat, PackageOpen, Settings, ShoppingBasket } from 'lucide-react'
import { useState } from 'react'
import MenuSection from './components/MenuSection'
import PantrySection from './components/PantrySection'
import PurchaseAreaSection from './components/PurchaseAreaSection'
import RecipesSection from './components/RecipesSection'
import SettingsSection from './components/SettingsSection'
import type { PantryNotice } from './lib/pantry-notice'

type Section = 'menu' | 'recetas' | 'compra' | 'despensa' | 'ajustes'

const sections: Array<{ id: Section; label: string; icon: typeof CalendarDays }> = [
  { id: 'menu', label: 'Menú', icon: CalendarDays },
  { id: 'recetas', label: 'Recetas', icon: ChefHat },
  { id: 'compra', label: 'Compra', icon: ShoppingBasket },
  { id: 'despensa', label: 'Despensa', icon: PackageOpen },
  { id: 'ajustes', label: 'Ajustes', icon: Settings },
]

function App() {
  const [section, setSectionState] = useState<Section>('menu')
  // Aviso para la despensa tras importar un ticket; se quita al cambiar de sección.
  const [pantryNotice, setPantryNotice] = useState<PantryNotice | null>(null)

  function setSection(next: Section) {
    setPantryNotice(null)
    setSectionState(next)
    window.scrollTo({ top: 0 })
  }

  function showImportedInPantry(notice: PantryNotice) {
    setSectionState('despensa')
    setPantryNotice(notice)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-neutral-900">
      {/* En el móvil la navegación va arriba: abajo la recortaban la barra de gestos y las esquinas de la pantalla. */}
      <nav className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 px-1 pb-1.5 pt-[calc(0.375rem+env(safe-area-inset-top))] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-0.5">
          {sections.map(({ id, label, icon: Icon }) => { const active = section === id; return <button key={id} onClick={() => setSection(id)} aria-current={active ? 'page' : undefined} className={`flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 text-[10.5px] font-medium tracking-tight ${active ? 'bg-neutral-900 text-white' : 'text-neutral-500'}`}><Icon size={18} strokeWidth={1.8} />{label}</button> })}
        </div>
      </nav>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-neutral-200 px-5 py-7 lg:block">
          <div className="px-2">
            <p className="text-xl font-semibold tracking-tight">Menu</p>
            <p className="mt-1 text-xs text-neutral-400">Planificación personal</p>
          </div>
          <nav className="mt-8 space-y-1">
            {sections.map(({ id, label, icon: Icon }) => {
              const active = section === id
              return <button key={id} onClick={() => setSection(id)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-white'}`}><Icon size={18} strokeWidth={1.8} />{label}</button>
            })}
          </nav>
        </aside>
        {/* Ocupa todo el ancho disponible; solo en pantallas muy anchas se limita para que no se estire de más. */}
        <main className="min-w-0 flex-1 px-4 pb-10 pt-5 sm:px-6 lg:px-10 lg:pt-9">
          <div className="mx-auto w-full max-w-[1800px]">
            {section === 'menu' && <MenuSection />}
            {section === 'recetas' && <RecipesSection />}
            {section === 'compra' && <PurchaseAreaSection onReceiptImported={showImportedInPantry} />}
            {section === 'despensa' && <PantrySection notice={pantryNotice} onDismissNotice={() => setPantryNotice(null)} />}
            {section === 'ajustes' && <SettingsSection />}
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
