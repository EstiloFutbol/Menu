import { ChevronDown, ChevronUp, MapPin, Pencil, ReceiptText, Store, Trash2, X } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const units = ['g', 'kg', 'ml', 'l', 'unidad', 'cucharada', 'cucharadita', 'taza', 'lata', 'paquete'] as const
type Unit = (typeof units)[number]

type Ingredient = { id: string; name: string }

type PurchaseItem = {
  id: string
  raw_name: string
  quantity: number | null
  unit: string | null
  packages: number | null
  package_unit_price: number | null
  price_before_discount: number
  discount_amount: number
  total_price: number
  reference_unit_price: number | null
  reference_unit: string | null
  notes: string | null
  ingredient: Ingredient | null
}

type Purchase = {
  id: string
  purchased_at: string
  store_name: string
  store_address: string | null
  total_amount: number
  discount_total: number
  currency: string
  receipt_number: string | null
  payment_method: string | null
  notes: string | null
  purchase_items: PurchaseItem[]
}

type PurchaseForm = {
  store_name: string
  store_address: string
  purchased_at: string
  total_amount: string
  discount_total: string
  receipt_number: string
  payment_method: string
  notes: string
}

type ItemForm = {
  raw_name: string
  ingredient_id: string
  quantity: string
  unit: Unit
  packages: string
  package_unit_price: string
  price_before_discount: string
  discount_amount: string
  total_price: string
  reference_unit_price: string
  reference_unit: string
  notes: string
}

function money(value: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value)
}

function quantityLabel(item: PurchaseItem) {
  if (item.quantity != null && item.unit) {
    return `${Number(item.quantity).toLocaleString('es-ES', { maximumFractionDigits: 3 })} ${item.unit}`
  }
  if (item.packages != null) {
    return `${Number(item.packages).toLocaleString('es-ES')} ${Number(item.packages) === 1 ? 'unidad' : 'unidades'}`
  }
  return null
}

function toDatetimeLocal(value: string) {
  const date = new Date(value)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function numberOrNull(value: string) {
  const trimmed = value.trim()
  return trimmed === '' ? null : Number(trimmed)
}

export default function PurchaseHistorySection() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openPurchase, setOpenPurchase] = useState<string | null>(null)
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null)
  const [editingItem, setEditingItem] = useState<{ purchase: Purchase; item: PurchaseItem } | null>(null)
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm | null>(null)
  const [itemForm, setItemForm] = useState<ItemForm | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError('')

    const [{ data, error: queryError }, { data: ingredientData, error: ingredientError }] = await Promise.all([
      supabase
        .from('purchases')
        .select(`
          id,
          purchased_at,
          store_name,
          store_address,
          total_amount,
          discount_total,
          currency,
          receipt_number,
          payment_method,
          notes,
          purchase_items (
            id,
            raw_name,
            quantity,
            unit,
            packages,
            package_unit_price,
            price_before_discount,
            discount_amount,
            total_price,
            reference_unit_price,
            reference_unit,
            notes,
            ingredient:ingredients(id,name)
          )
        `)
        .order('purchased_at', { ascending: false }),
      supabase.from('ingredients').select('id,name').order('name'),
    ])

    if (queryError || ingredientError) setError(queryError?.message ?? ingredientError?.message ?? 'No se pudo cargar el historial.')
    else {
      setPurchases((data ?? []) as unknown as Purchase[])
      setIngredients((ingredientData ?? []) as Ingredient[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const totals = useMemo(() => {
    const spent = purchases.reduce((sum, purchase) => sum + Number(purchase.total_amount), 0)
    return { count: purchases.length, spent, average: purchases.length ? spent / purchases.length : 0 }
  }, [purchases])

  function startPurchaseEdit(purchase: Purchase) {
    setError('')
    setEditingPurchase(purchase)
    setPurchaseForm({
      store_name: purchase.store_name,
      store_address: purchase.store_address ?? '',
      purchased_at: toDatetimeLocal(purchase.purchased_at),
      total_amount: String(purchase.total_amount),
      discount_total: String(purchase.discount_total),
      receipt_number: purchase.receipt_number ?? '',
      payment_method: purchase.payment_method ?? '',
      notes: purchase.notes ?? '',
    })
  }

  function startItemEdit(purchase: Purchase, item: PurchaseItem) {
    setError('')
    setEditingItem({ purchase, item })
    setItemForm({
      raw_name: item.raw_name,
      ingredient_id: item.ingredient?.id ?? '',
      quantity: item.quantity == null ? '' : String(item.quantity),
      unit: (item.unit as Unit) || 'unidad',
      packages: item.packages == null ? '' : String(item.packages),
      package_unit_price: item.package_unit_price == null ? '' : String(item.package_unit_price),
      price_before_discount: String(item.price_before_discount),
      discount_amount: String(item.discount_amount),
      total_price: String(item.total_price),
      reference_unit_price: item.reference_unit_price == null ? '' : String(item.reference_unit_price),
      reference_unit: item.reference_unit ?? '',
      notes: item.notes ?? '',
    })
  }

  async function savePurchase(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !editingPurchase || !purchaseForm) return
    setSaving(true)
    setError('')
    const total = Number(purchaseForm.total_amount)
    const discount = Number(purchaseForm.discount_total || 0)
    if (!purchaseForm.store_name.trim() || !Number.isFinite(total) || total < 0 || !Number.isFinite(discount) || discount < 0) {
      setError('Revisa tienda, total y descuento.')
      setSaving(false)
      return
    }
    const { error: updateError } = await supabase.from('purchases').update({
      store_name: purchaseForm.store_name.trim(),
      store_address: purchaseForm.store_address.trim() || null,
      purchased_at: new Date(purchaseForm.purchased_at).toISOString(),
      total_amount: total,
      discount_total: discount,
      receipt_number: purchaseForm.receipt_number.trim() || null,
      payment_method: purchaseForm.payment_method.trim() || null,
      notes: purchaseForm.notes.trim() || null,
    }).eq('id', editingPurchase.id)
    setSaving(false)
    if (updateError) { setError(updateError.message); return }
    setEditingPurchase(null)
    setPurchaseForm(null)
    await load()
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !editingItem || !itemForm) return
    setSaving(true)
    setError('')
    const quantity = numberOrNull(itemForm.quantity)
    const packages = numberOrNull(itemForm.packages)
    const packageUnitPrice = numberOrNull(itemForm.package_unit_price)
    const before = Number(itemForm.price_before_discount)
    const discount = Number(itemForm.discount_amount || 0)
    const total = Number(itemForm.total_price)
    const referencePrice = numberOrNull(itemForm.reference_unit_price)
    if (!itemForm.raw_name.trim() || (quantity !== null && quantity < 0) || (packages !== null && packages < 0) || !Number.isFinite(before) || before < 0 || !Number.isFinite(discount) || discount < 0 || !Number.isFinite(total) || total < 0) {
      setError('Revisa nombre, cantidades y precios.')
      setSaving(false)
      return
    }
    const { error: updateError } = await supabase.from('purchase_items').update({
      raw_name: itemForm.raw_name.trim(),
      ingredient_id: itemForm.ingredient_id || null,
      quantity,
      unit: quantity === null ? null : itemForm.unit,
      packages,
      package_unit_price: packageUnitPrice,
      price_before_discount: before,
      discount_amount: discount,
      total_price: total,
      reference_unit_price: referencePrice,
      reference_unit: referencePrice === null ? null : (itemForm.reference_unit.trim() || null),
      notes: itemForm.notes.trim() || null,
    }).eq('id', editingItem.item.id)
    setSaving(false)
    if (updateError) { setError(updateError.message); return }
    setEditingItem(null)
    setItemForm(null)
    await load()
  }

  async function deleteItem(item: PurchaseItem) {
    if (!supabase || !window.confirm(`¿Eliminar “${item.raw_name}” de este ticket?`)) return
    setError('')
    const { error: deleteError } = await supabase.from('purchase_items').delete().eq('id', item.id)
    if (deleteError) { setError(deleteError.message); return }
    await load()
  }

  async function deleteIngredient(ingredient: Ingredient) {
    if (!supabase || !window.confirm(`¿Eliminar “${ingredient.name}” del catálogo de alimentos? También se eliminará de la despensa si está allí.`)) return
    setError('')
    const { error: deleteError } = await supabase.from('ingredients').delete().eq('id', ingredient.id)
    if (deleteError) {
      setError(deleteError.message.includes('foreign key') ? 'No se puede eliminar porque este alimento está utilizado en una receta o consumo. Puedes cambiarle el nombre desde Recetas/Despensa.' : deleteError.message)
      return
    }
    if (itemForm) setItemForm((current) => current ? { ...current, ingredient_id: '' } : current)
    await load()
  }

  if (loading) return <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-sm text-neutral-500 shadow-sm">Cargando historial…</div>

  return (
    <div className="space-y-5">
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-neutral-500">Tickets</p><p className="mt-1 text-2xl font-semibold text-neutral-950">{totals.count}</p></div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-neutral-500">Gasto registrado</p><p className="mt-1 text-2xl font-semibold text-neutral-950">{money(totals.spent)}</p></div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium text-neutral-500">Ticket medio</p><p className="mt-1 text-2xl font-semibold text-neutral-950">{money(totals.average)}</p></div>
      </div>

      {purchases.length === 0 ? (
        <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-sm"><ReceiptText className="mx-auto text-neutral-300" size={28} /><p className="mt-3 text-sm font-medium text-neutral-800">Todavía no hay compras registradas.</p><p className="mt-1 text-sm text-neutral-500">Aquí aparecerán los tickets y precios históricos.</p></div>
      ) : (
        <div className="space-y-3">
          {purchases.map((purchase) => {
            const open = openPurchase === purchase.id
            const date = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(purchase.purchased_at))
            const items = purchase.purchase_items?.slice().sort((a, b) => a.raw_name.localeCompare(b.raw_name, 'es')) ?? []
            return (
              <section key={purchase.id} className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setOpenPurchase(open ? null : purchase.id)} className="flex min-w-0 flex-1 items-center justify-between gap-4 p-5 text-left hover:bg-neutral-50">
                    <div className="min-w-0"><div className="flex items-center gap-2"><Store size={17} className="text-neutral-400" /><h3 className="truncate font-semibold text-neutral-950">{purchase.store_name}</h3></div><p className="mt-1 text-sm text-neutral-500">{date} · {items.length} productos</p>{purchase.store_address && <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-neutral-400"><MapPin size={12} /> {purchase.store_address}</p>}</div>
                    <div className="flex shrink-0 items-center gap-3"><div className="text-right"><p className="text-lg font-semibold text-neutral-950">{money(Number(purchase.total_amount))}</p>{Number(purchase.discount_total) > 0 && <p className="text-xs text-emerald-700">-{money(Number(purchase.discount_total))} dto.</p>}</div>{open ? <ChevronUp size={18} className="text-neutral-400" /> : <ChevronDown size={18} className="text-neutral-400" />}</div>
                  </button>
                  <button type="button" onClick={() => startPurchaseEdit(purchase)} className="mr-4 rounded-xl p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" aria-label="Editar ticket"><Pencil size={17} /></button>
                </div>

                {open && <div className="border-t border-neutral-100 px-5 pb-5"><div className="divide-y divide-neutral-100">
                  {items.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 py-3"><div className="min-w-0"><p className="text-sm font-medium text-neutral-800">{item.ingredient?.name ?? item.raw_name}</p><p className="mt-0.5 text-xs text-neutral-400">{item.raw_name}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">{quantityLabel(item) && <span>{quantityLabel(item)}</span>}{item.reference_unit_price != null && item.reference_unit && <span>{money(Number(item.reference_unit_price))}/{item.reference_unit}</span>}{item.package_unit_price != null && Number(item.packages ?? 1) > 1 && <span>{Number(item.packages)} × {money(Number(item.package_unit_price))}</span>}</div></div><div className="flex shrink-0 items-center gap-2"><div className="text-right"><p className="text-sm font-semibold text-neutral-900">{money(Number(item.total_price))}</p>{Number(item.discount_amount) > 0 && <p className="text-xs text-emerald-700">Dto. {money(Number(item.discount_amount))}</p>}</div><button type="button" onClick={() => startItemEdit(purchase, item)} className="rounded-xl p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900" aria-label={`Editar ${item.raw_name}`}><Pencil size={16} /></button><button type="button" onClick={() => void deleteItem(item)} className="rounded-xl p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600" aria-label={`Eliminar ${item.raw_name}`}><Trash2 size={16} /></button></div></div>)}
                </div>{(purchase.payment_method || purchase.receipt_number || purchase.notes) && <div className="mt-3 rounded-2xl bg-neutral-50 px-4 py-3 text-xs text-neutral-500">{purchase.payment_method && <p>Pago: {purchase.payment_method}</p>}{purchase.receipt_number && <p>Ticket: {purchase.receipt_number}</p>}{purchase.notes && <p>Notas: {purchase.notes}</p>}</div>}</div>}
              </section>
            )
          })}
        </div>
      )}

      {purchaseForm && editingPurchase && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><form onSubmit={savePurchase} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6"><div className="flex items-center justify-between"><div><p className="text-sm text-neutral-500">Historial</p><h2 className="text-xl font-semibold">Editar compra</h2></div><button type="button" onClick={() => { setPurchaseForm(null); setEditingPurchase(null) }} className="rounded-xl p-2 hover:bg-neutral-100"><X size={19} /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Tienda<input value={purchaseForm.store_name} onChange={e => setPurchaseForm({ ...purchaseForm, store_name: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Fecha y hora<input type="datetime-local" value={purchaseForm.purchased_at} onChange={e => setPurchaseForm({ ...purchaseForm, purchased_at: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium sm:col-span-2">Dirección<input value={purchaseForm.store_address} onChange={e => setPurchaseForm({ ...purchaseForm, store_address: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Total<input type="number" min="0" step="0.01" value={purchaseForm.total_amount} onChange={e => setPurchaseForm({ ...purchaseForm, total_amount: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Descuento total<input type="number" min="0" step="0.01" value={purchaseForm.discount_total} onChange={e => setPurchaseForm({ ...purchaseForm, discount_total: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Número de ticket<input value={purchaseForm.receipt_number} onChange={e => setPurchaseForm({ ...purchaseForm, receipt_number: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Forma de pago<input value={purchaseForm.payment_method} onChange={e => setPurchaseForm({ ...purchaseForm, payment_method: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium sm:col-span-2">Notas<textarea rows={3} value={purchaseForm.notes} onChange={e => setPurchaseForm({ ...purchaseForm, notes: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => { setPurchaseForm(null); setEditingPurchase(null) }} className="rounded-2xl px-4 py-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100">Cancelar</button><button disabled={saving} className="rounded-2xl bg-neutral-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar cambios'}</button></div></form></div>}

      {itemForm && editingItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><form onSubmit={saveItem} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-6"><div className="flex items-center justify-between"><div><p className="text-sm text-neutral-500">Producto del ticket</p><h2 className="text-xl font-semibold">Editar producto</h2></div><button type="button" onClick={() => { setItemForm(null); setEditingItem(null) }} className="rounded-xl p-2 hover:bg-neutral-100"><X size={19} /></button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium sm:col-span-2">Nombre del ticket<input value={itemForm.raw_name} onChange={e => setItemForm({ ...itemForm, raw_name: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium sm:col-span-2">Alimento del catálogo<select value={itemForm.ingredient_id} onChange={e => setItemForm({ ...itemForm, ingredient_id: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 font-normal"><option value="">Sin asociar</option>{ingredients.map(ingredient => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}</select></label><div className="sm:col-span-2 flex items-center justify-between rounded-2xl bg-neutral-50 px-4 py-3 text-xs text-neutral-500">{itemForm.ingredient_id ? <span>¿Es un alimento mal escrito? Puedes eliminarlo del catálogo abajo.</span> : <span>Asocia este producto a un alimento existente para usarlo en Despensa/Recetas.</span>}{itemForm.ingredient_id && <button type="button" onClick={() => { const ingredient = ingredients.find(i => i.id === itemForm.ingredient_id); if (ingredient) void deleteIngredient(ingredient) }} className="shrink-0 font-medium text-red-600 hover:text-red-700">Eliminar alimento</button>}</div><label className="text-sm font-medium">Cantidad<input type="number" min="0" step="0.001" value={itemForm.quantity} onChange={e => setItemForm({ ...itemForm, quantity: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Unidad<select value={itemForm.unit} onChange={e => setItemForm({ ...itemForm, unit: e.target.value as Unit })} className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 font-normal">{units.map(unit => <option key={unit}>{unit}</option>)}</select></label><label className="text-sm font-medium">Envases/unidades<input type="number" min="0" step="1" value={itemForm.packages} onChange={e => setItemForm({ ...itemForm, packages: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Precio por envase<input type="number" min="0" step="0.01" value={itemForm.package_unit_price} onChange={e => setItemForm({ ...itemForm, package_unit_price: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Precio antes descuento<input type="number" min="0" step="0.01" value={itemForm.price_before_discount} onChange={e => setItemForm({ ...itemForm, price_before_discount: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Descuento<input type="number" min="0" step="0.01" value={itemForm.discount_amount} onChange={e => setItemForm({ ...itemForm, discount_amount: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Total producto<input type="number" min="0" step="0.01" value={itemForm.total_price} onChange={e => setItemForm({ ...itemForm, total_price: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Precio de referencia<input type="number" min="0" step="0.001" value={itemForm.reference_unit_price} onChange={e => setItemForm({ ...itemForm, reference_unit_price: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium">Unidad de referencia<input value={itemForm.reference_unit} onChange={e => setItemForm({ ...itemForm, reference_unit: e.target.value })} placeholder="kg, l…" className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label><label className="text-sm font-medium sm:col-span-2">Notas<textarea rows={2} value={itemForm.notes} onChange={e => setItemForm({ ...itemForm, notes: e.target.value })} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => { setItemForm(null); setEditingItem(null) }} className="rounded-2xl px-4 py-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100">Cancelar</button><button disabled={saving} className="rounded-2xl bg-neutral-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar cambios'}</button></div></form></div>}
    </div>
  )
}
