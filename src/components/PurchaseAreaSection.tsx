import { Camera, ReceiptText, ShoppingBasket } from 'lucide-react'
import { useState } from 'react'
import PurchaseHistorySection from './PurchaseHistorySection'
import ReceiptImportSection from './ReceiptImportSection'
import ShoppingSection from './ShoppingSection'
import type { PantryNotice } from '../lib/pantry-notice'
import { getLeaveGuard, setLeaveGuard, type LeaveGuard } from '../lib/leave-guard'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import { useRequestedTab } from '../lib/tutorial'

type View = 'lista' | 'ticket' | 'historial'

export default function PurchaseAreaSection({ onReceiptImported }: { onReceiptImported?: (notice: PantryNotice) => void }) {
  const [view, setViewState] = useState<View>('lista')
  // Pestaña a la que se quiere ir mientras se pregunta por un ticket a medias.
  const [pendingView, setPendingView] = useState<{ view: View; guard: LeaveGuard } | null>(null)

  useRequestedTab('compra', (next) => setViewState(next as View))

  function setView(next: View) {
    const guard = getLeaveGuard()
    if (guard && next !== view) { setPendingView({ view: next, guard }); return }
    setViewState(next)
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-4 sm:items-end">
        <div className="min-w-0">
          <p className="hidden text-sm font-medium text-neutral-500 sm:block">Compra</p>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-950 sm:mt-1 sm:text-3xl">Compra y precios</h1>
          <p className="mt-2 hidden text-sm text-neutral-500 sm:block">Planifica la compra, importa tickets y conserva el histórico de precios.</p>
        </div>
        <div data-tour="compra-pestanas" className="grid shrink-0 grid-cols-3 rounded-2xl bg-neutral-100 p-1">
          <button
            onClick={() => setView('lista')}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${view === 'lista' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}
          >
            <ShoppingBasket size={16} /> <span className="hidden sm:inline">Lista</span>
          </button>
          <button
            onClick={() => setView('ticket')}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${view === 'ticket' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}
          >
            <Camera size={16} /> <span className="hidden sm:inline">Ticket</span>
          </button>
          <button
            onClick={() => setView('historial')}
            className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${view === 'historial' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}
          >
            <ReceiptText size={16} /> <span className="hidden sm:inline">Historial</span>
          </button>
        </div>
      </header>

      {pendingView && <UnsavedChangesDialog guard={pendingView.guard} onStay={() => setPendingView(null)} onLeave={() => { setLeaveGuard(null); setViewState(pendingView.view); setPendingView(null) }} />}
      {view === 'lista' && <ShoppingSection />}
      {view === 'ticket' && <ReceiptImportSection onImported={onReceiptImported} />}
      {view === 'historial' && <PurchaseHistorySection />}
    </div>
  )
}
