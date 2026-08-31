import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const units = ['g', 'kg', 'ml', 'l', 'unidad', 'cucharada', 'cucharadita', 'taza', 'lata', 'paquete'] as const
type Unit = (typeof units)[number]

type PantryRow = { quantity: number | null; unit: Unit | null; status: 'tengo' | 'queda_poco' | 'no_tengo' | null }

type Props = {
  entryId: string
  productId: string
  productName: string
  quantity: number
  unit: Unit
  onClose: () => void
  onCompleted: () => void
}

function compatible(quantity: number, from: Unit, to: Unit) {
  if (from === to) return quantity
  if (from === 'g' && to === 'kg') return quantity / 1000
  if (from === 'kg' && to === 'g') return quantity * 1000
  if (from === 'ml' && to === 'l') return quantity / 1000
  if (from === 'l' && to === 'ml') return quantity * 1000
  return null
}

export default function CompleteProductModal({ entryId, productId, productName, quantity, unit, onClose, onCompleted }: Props) {
  const [usedQuantity, setUsedQuantity] = useState(String(quantity))
  const [usedUnit, setUsedUnit] = useState<Unit>(unit)
  const [pantry, setPantry] = useState<PantryRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      if (!supabase) return
      try {
        const { data: product, error: productError } = await supabase.from('menu_entry_products').select('ingredient_id').eq('id', productId).single()
        if (productError) throw productError
        const { data, error: pantryError } = await supabase.from('pantry_items').select('quantity,unit,status').eq('ingredient_id', product.ingredient_id).maybeSingle()
        if (pantryError) throw pantryError
        setPantry((data ?? null) as PantryRow | null)
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo consultar la despensa.') }
      finally { setLoading(false) }
    }
    void load()
  }, [productId])

  const converted = pantry?.quantity !== null && pantry?.quantity !== undefined && pantry?.unit ? compatible(Number(usedQuantity || 0), usedUnit, pantry.unit) : null
  const canDeduct = converted !== null

  const confirm = async () => {
    if (!supabase) return
    if (!usedQuantity.trim() || Number(usedQuantity) <= 0) { setError('La cantidad debe ser mayor que cero.'); return }
    setSaving(true); setError('')
    try {
      const { error: rpcError } = await supabase.rpc('complete_planned_product', { p_menu_entry_product_id: productId, p_quantity: Number(usedQuantity), p_unit: usedUnit })
      if (rpcError) throw rpcError
      onCompleted()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo completar el producto.'
      setError(message.includes('already been completed') ? 'Este producto ya estaba completado. No se ha descontado nada de nuevo.' : message)
    } finally { setSaving(false) }
  }

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <div className="w-full max-w-xl rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-neutral-500">Confirmar consumo</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">{productName}</h2><p className="mt-1 text-sm text-neutral-500">Producto directo del menú</p></div><button disabled={saving} onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-100"><X size={19} /></button></div>
      <p className="mt-5 text-sm leading-6 text-neutral-600">Revisa la cantidad realmente consumida antes de descontarla de la despensa.</p>
      {loading ? <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-500">Consultando despensa…</div> : <>
        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_130px]"><div><label className="mb-1 block text-xs font-medium text-neutral-500">Cantidad consumida</label><input type="number" min="0.01" step="0.01" value={usedQuantity} onChange={(event) => setUsedQuantity(event.target.value)} className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400" /></div><div><label className="mb-1 block text-xs font-medium text-neutral-500">Unidad</label><select value={usedUnit} onChange={(event) => setUsedUnit(event.target.value as Unit)} className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm">{units.map((item) => <option key={item}>{item}</option>)}</select></div></div>
        <div className={`mt-4 flex items-start gap-2 rounded-2xl border px-4 py-3 text-xs ${canDeduct ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {canDeduct ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
          <div>{pantry?.quantity !== null && pantry?.quantity !== undefined && pantry?.unit ? `Despensa: ${pantry.quantity} ${pantry.unit}. Se descontará automáticamente.` : `Despensa: ${pantry?.status === 'queda_poco' ? 'Queda poco' : pantry?.status === 'no_tengo' ? 'No tengo' : 'cantidad desconocida'}. No se puede descontar automáticamente.`}</div>
        </div>
      </>}
      {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="mt-6 flex justify-end gap-2"><button disabled={saving} onClick={onClose} className="rounded-2xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700">Cancelar</button><button disabled={loading || saving} onClick={() => void confirm()} className="rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Confirmando…' : 'Confirmar y descontar'}</button></div>
    </div>
  </div>
}
