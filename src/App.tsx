import { CalendarDays, ChefHat, PackageOpen, ShoppingBasket } from 'lucide-react'
import { useState } from 'react'
import MenuSection from './components/MenuSection'
import PantrySection from './components/PantrySection'
import PurchaseAreaSection from './components/PurchaseAreaSection'
import RecipesSection from './components/RecipesSection'

type Section = 'menu' | 'recetas' | 'compra' | 'despensa'

const sections: Array<{ id: Section; label: string; icon: typeof CalendarDays }> = [
  { id: 'menu', label: 'Menú', icon: CalendarDays },
  { id: 'recetas', label: 'Recetas', icon: ChefHat },
  { id: 'compra', label: 'Compra', icon: ShoppingBasket },
  { id: 'despensa', label: 'Despensa', icon: PackageOpen },
]

function App() {
  const [section, setSection] = useState<Section>('menu')

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-neutral-900">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-64 shrink-0 border-r border-neutral-200 px-5 py-7 lg:block">
          <div className="px-2">
            <p className="text-xl font-semibold tracking-tight">Menu</p>
            <p className="mt-1 text-xs text-neutral-400">Planificación personal</p>
          </div>
          <nav className="mt-8 space-y-1">
            {sections.map(({ id, label, icon: Icon }) => {
              const active = section === id
              return (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition ${
                    active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-white'
                  }`}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  {label}
                </button>
              )
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-10 lg:pt-9">
          {section === 'menu' && <MenuSection />}
          {section === 'recetas' && <RecipesSection />}
          {section === 'compra' && <PurchaseAreaSection />}
          {section === 'despensa' && <PantrySection />}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 px-2 py-2 backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
          {sections.map(({ id, label, icon: Icon }) => {
            const active = section === id
            return (
              <button
                key={id}
                onClick={() => setSection(id)}
                className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-medium ${
                  active ? 'bg-neutral-900 text-white' : 'text-neutral-500'
                }`}
              >
                <Icon size={18} strokeWidth={1.8} />
                {label}
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}

export default App
