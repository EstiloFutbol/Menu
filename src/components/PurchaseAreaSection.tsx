import { ReceiptText, ShoppingBasket } from 'lucide-react'
import { useState } from 'react'
import PurchaseHistorySection from './PurchaseHistorySection'
import ShoppingSection from './ShoppingSection'

type View = 'lista' | 'historial'

export default function PurchaseAreaSection() {
  const [view, setView] = useState<View>('lista')

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-500">Compra</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">Compra y precios</h1>
          <p className="mt-2 text-sm text-neutral-500">Planifica la compra y conserva un histórico de tickets y precios.</p>
        </div>
        <div className="grid grid-cols-2 rounded-2xl bg-neutral-100 p-1">
          <button
            onClick={() => setView('lista')}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${view === 'lista' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}
          >
            <ShoppingBasket size={16} /> Lista
          </button>
          <button
            onClick={() => setView('historial')}
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ${view === 'historial' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}
          >
            <ReceiptText size={16} /> Historial
          </button>
        </div>
      </header>

      {view === 'lista' ? <ShoppingSection /> : <PurchaseHistorySection />}
    </div>
  )
}
