import { CalendarDays, ChefHat, PackageOpen, ShoppingBasket } from 'lucide-react'
import { useState } from 'react'

type Section = 'menu' | 'recetas' | 'compra' | 'despensa'

const sections: Array<{ id: Section; label: string; icon: typeof CalendarDays }> = [
  { id: 'menu', label: 'Menú', icon: CalendarDays },
  { id: 'recetas', label: 'Recetas', icon: ChefHat },
  { id: 'compra', label: 'Compra', icon: ShoppingBasket },
  { id: 'despensa', label: 'Despensa', icon: PackageOpen },
]

const meals = ['Desayuno', 'Almuerzo', 'Comida', 'Merienda', 'Cena']

function EmptyCard({ title, text, action }: { title: string; text: string; action: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">{text}</p>
      <button className="mt-5 rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700">
        {action}
      </button>
    </div>
  )
}

function MenuSection() {
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-neutral-500">Semana actual</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">Tu menú</h1>
        </div>
        <button className="rounded-2xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm">
          Copiar semana
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((day) => (
          <section key={day} className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-neutral-900">{day}</h2>
            <div className="mt-4 divide-y divide-neutral-100">
              {meals.map((meal) => (
                <div key={meal} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium text-neutral-800">{meal}</p>
                    <p className="mt-0.5 text-xs text-neutral-400">Sin planificar</p>
                  </div>
                  <button className="rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
                    Añadir
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

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
          {section === 'recetas' && (
            <EmptyCard
              title="Tus recetas"
              text="Aquí guardarás recetas con raciones, ingredientes estructurados, cantidades, pasos e información nutricional por ración."
              action="Crear primera receta"
            />
          )}
          {section === 'compra' && (
            <EmptyCard
              title="Lista de la compra"
              text="La lista se generará a partir del menú y descontará automáticamente las existencias conocidas de la despensa."
              action="Generar lista"
            />
          )}
          {section === 'despensa' && (
            <EmptyCard
              title="Tu despensa"
              text="Podrás controlar productos con cantidades exactas o simplemente marcar si tienes, queda poco o no tienes."
              action="Añadir producto"
            />
          )}
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
