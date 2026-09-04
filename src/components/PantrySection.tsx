import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, PackageOpen, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { shouldShowPantryItem } from '../lib/domain'
import { supabase } from '../lib/supabase'

const units = ['g', 'kg', 'ml', 'l', 'unidad', 'cucharada', 'cucharadita', 'taza', 'lata', 'paquete'] as const
const categories = ['Fruta y verdura', 'Carne', 'Pescado y marisco', 'Lácteos y huevos', 'Panadería', 'Despensa', 'Congelados', 'Bebidas', 'Salsas y condimentos', 'Otros'] as const
const statuses = [
  { value: 'tengo', label: 'Tengo' },
  { value: 'queda_poco', label: 'Queda poco' },
  { value: 'no_tengo', label: 'No tengo' },
] as const

type Unit = (typeof units)[number]
type PantryStatus = (typeof statuses)[number]['value']
type TrackingMode = 'quantity' | 'status'
type Ingredient = { id: string; name: string; category: string | null; default_unit: Unit | null }
type PantryItem = { id: string; quantity: number | null; unit: Unit | null; status: PantryStatus | null; notes: string | null; ingredient: Ingredient }
type FormState = { ingredientId: string; ingredientName: string; category: string; defaultUnit: Unit; isNewIngredient: boolean; mode: TrackingMode; quantity: string; unit: Unit; status: PantryStatus; notes: string }

const emptyForm = (): FormState => ({ ingredientId: '', ingredientName: '', category: 'Despensa', defaultUnit: 'unidad', isNewIngredient: false, mode: 'quantity', quantity: '', unit: 'unidad', status: 'tengo', notes: '' })
function formatQuantity(value: number) { return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))) }

function PantrySection() {
  const [items, setItems] = useState<PantryItem[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [ingredientQuery, setIngredientQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError(null)
    const [{ data: ingredientData, error: ingredientError }, { data: pantryData, error: pantryError }] = await Promise.all([
      supabase.from('ingredients').select('id,name,category,default_unit').order('name'),
      supabase.from('pantry_items').select('id,quantity,unit,status,notes,ingredient:ingredients(id,name,category,default_unit)').order('updated_at', { ascending: false }),
    ])
    if (ingredientError || pantryError) { setError(ingredientError?.message ?? pantryError?.message ?? 'No se pudo cargar la despensa.'); setLoading(false); return }
    setIngredients((ingredientData ?? []) as Ingredient[])
    setItems((pantryData ?? []) as unknown as PantryItem[])
    setLoading(false)
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const visibleItems = useMemo(() => items.filter(shouldShowPantryItem), [items])
  const filteredItems = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return visibleItems
    return visibleItems.filter((item) => [item.ingredient.name, item.ingredient.category ?? '', item.notes ?? ''].some((text) => text.toLowerCase().includes(value)))
  }, [visibleItems, query])
  const groupedItems = useMemo(() => {
    const groups = new Map<string, PantryItem[]>()
    filteredItems.forEach((item) => { const category = item.ingredient.category ?? 'Otros'; groups.set(category, [...(groups.get(category) ?? []), item]) })
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, 'es'))
  }, [filteredItems])
  const lowStockCount = visibleItems.filter((item) => item.status === 'queda_poco').length

  const ingredientMatches = useMemo(() => {
    const value = ingredientQuery.trim().toLowerCase()
    if (!value) return ingredients.slice(0, 8)
    return ingredients.filter((ingredient) => ingredient.name.toLowerCase().includes(value)).slice(0, 8)
  }, [ingredients, ingredientQuery])

  function openCreate() { setEditingId(null); setForm(emptyForm()); setIngredientQuery(''); setError(null); setFormOpen(true) }
  function openEdit(item: PantryItem) {
    setEditingId(item.id); setIngredientQuery(item.ingredient.name)
    setForm({ ingredientId: item.ingredient.id, ingredientName: item.ingredient.name, category: item.ingredient.category ?? 'Otros', defaultUnit: item.ingredient.default_unit ?? item.unit ?? 'unidad', isNewIngredient: false, mode: item.quantity !== null ? 'quantity' : 'status', quantity: item.quantity !== null ? formatQuantity(item.quantity) : '', unit: item.unit ?? item.ingredient.default_unit ?? 'unidad', status: item.status ?? 'tengo', notes: item.notes ?? '' })
    setError(null); setFormOpen(true)
  }
  function selectIngredient(ingredient: Ingredient) {
    const unit = ingredient.default_unit ?? 'unidad'
    setForm((current) => ({ ...current, ingredientId: ingredient.id, ingredientName: ingredient.name, category: ingredient.category ?? 'Otros', defaultUnit: unit, unit, isNewIngredient: false }))
    setIngredientQuery(ingredient.name)
  }
  function chooseNewIngredient() { const name = ingredientQuery.trim(); if (!name) return; setForm((current) => ({ ...current, ingredientId: '', ingredientName: name, isNewIngredient: true })) }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault(); if (!supabase) return; setError(null)
    if (!form.ingredientId && !form.isNewIngredient) { setError('Selecciona un ingrediente o crea uno nuevo.'); return }
    if (form.mode === 'quantity' && (!form.quantity || Number(form.quantity) < 0)) { setError('Indica una cantidad válida.'); return }
    setSaving(true)
    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) { setError('No se pudo identificar tu usuario.'); setSaving(false); return }
    let ingredientId = form.ingredientId
    if (form.isNewIngredient) {
      const { data: createdIngredient, error: createIngredientError } = await supabase.from('ingredients').insert({ user_id: authData.user.id, name: form.ingredientName.trim(), category: form.category, default_unit: form.defaultUnit }).select('id').single()
      if (createIngredientError || !createdIngredient) { setError(createIngredientError?.message ?? 'No se pudo crear el ingrediente.'); setSaving(false); return }
      ingredientId = createdIngredient.id
    }
    const payload = { user_id: authData.user.id, ingredient_id: ingredientId, quantity: form.mode === 'quantity' ? Number(form.quantity) : null, unit: form.mode === 'quantity' ? form.unit : null, status: form.mode === 'status' ? form.status : null, notes: form.notes.trim() || null }
    const result = editingId ? await supabase.from('pantry_items').update(payload).eq('id', editingId) : await supabase.from('pantry_items').insert(payload)
    if (result.error) { setError(result.error.message.includes('pantry_items_user_id_ingredient_id_key') ? 'Ese ingrediente ya está en tu despensa.' : result.error.message); setSaving(false); return }
    setSaving(false); setFormOpen(false); await loadData()
  }

  async function deleteItem(item: PantryItem) {
    if (!supabase || !window.confirm(`¿Eliminar ${item.ingredient.name} de la despensa?`)) return
    const { error: deleteError } = await supabase.from('pantry_items').delete().eq('id', item.id)
    if (deleteError) { setError(deleteError.message); return }
    await loadData()
  }

  if (formOpen) return <div className="mx-auto max-w-3xl space-y-5">
    <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium text-neutral-500">Despensa</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">{editingId ? 'Editar producto' : 'Añadir producto'}</h1></div><button type="button" onClick={() => setFormOpen(false)} className="rounded-2xl border border-neutral-200 bg-white p-2.5 text-neutral-600 shadow-sm" aria-label="Cerrar"><X size={19} /></button></div>
    <form onSubmit={handleSubmit} className="space-y-5">
      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-semibold">Ingrediente</h2>{editingId ? <div className="mt-4 rounded-2xl bg-neutral-50 px-4 py-3"><p className="font-medium">{form.ingredientName}</p><p className="mt-1 text-xs text-neutral-500">{form.category}</p></div> : <div className="relative mt-4"><label className="text-sm font-medium text-neutral-700">Buscar ingrediente</label><input value={ingredientQuery} onChange={(event) => { setIngredientQuery(event.target.value); setForm((current) => ({ ...current, ingredientId: '', ingredientName: '', isNewIngredient: false })) }} placeholder="Ej. arroz, leche, tomate..." className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-neutral-400" />{ingredientQuery && !form.ingredientId && !form.isNewIngredient && <div className="mt-2 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-lg">{ingredientMatches.map((ingredient) => <button type="button" key={ingredient.id} onClick={() => selectIngredient(ingredient)} className="flex w-full items-center justify-between border-b border-neutral-100 px-4 py-3 text-left last:border-0 hover:bg-neutral-50"><span className="text-sm font-medium">{ingredient.name}</span><span className="text-xs text-neutral-400">{ingredient.category ?? 'Sin categoría'}</span></button>)}{!ingredients.some((ingredient) => ingredient.name.toLowerCase() === ingredientQuery.trim().toLowerCase()) && <button type="button" onClick={chooseNewIngredient} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium"><Plus size={16} /> Crear “{ingredientQuery.trim()}”</button>}</div>}</div>}
        {form.isNewIngredient && <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-neutral-700">Categoría<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm">{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="text-sm font-medium text-neutral-700">Unidad habitual<select value={form.defaultUnit} onChange={(event) => { const unit = event.target.value as Unit; setForm((current) => ({ ...current, defaultUnit: unit, unit })) }} className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm">{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div>}
      </section>
      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6"><h2 className="text-lg font-semibold">Cómo quieres controlarlo</h2><div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-neutral-100 p-1"><button type="button" onClick={() => setForm((current) => ({ ...current, mode: 'quantity' }))} className={`rounded-xl px-3 py-2.5 text-sm font-medium ${form.mode === 'quantity' ? 'bg-white shadow-sm' : 'text-neutral-500'}`}>Cantidad exacta</button><button type="button" onClick={() => setForm((current) => ({ ...current, mode: 'status' }))} className={`rounded-xl px-3 py-2.5 text-sm font-medium ${form.mode === 'status' ? 'bg-white shadow-sm' : 'text-neutral-500'}`}>Solo estado</button></div>
        {form.mode === 'quantity' ? <div className="mt-4 grid grid-cols-[1fr_140px] gap-3"><label className="text-sm font-medium text-neutral-700">Cantidad<input type="number" min="0" step="0.001" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm" /></label><label className="text-sm font-medium text-neutral-700">Unidad<select value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value as Unit }))} className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-3 py-3 text-sm">{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div> : <div className="mt-4 grid gap-2 sm:grid-cols-3">{statuses.map((status) => <button type="button" key={status.value} onClick={() => setForm((current) => ({ ...current, status: status.value }))} className={`rounded-2xl border px-4 py-3 text-sm font-medium ${form.status === status.value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white text-neutral-600'}`}>{status.label}</button>)}</div>}
        <label className="mt-5 block text-sm font-medium text-neutral-700">Notas <span className="font-normal text-neutral-400">(opcional)</span><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={3} placeholder="Ej. paquete abierto, congelado..." className="mt-2 w-full resize-none rounded-2xl border border-neutral-200 px-4 py-3 text-sm" /></label>
      </section>
      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={saving} className="w-full rounded-2xl bg-neutral-900 px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">{saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Añadir a despensa'}</button>
    </form>
  </div>

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-neutral-500">Inventario</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">Tu despensa</h1><p className="mt-2 text-sm text-neutral-500">Solo ves lo que realmente queda en casa.</p></div><button onClick={openCreate} className="flex items-center gap-2 rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white"><Plus size={17} /> Añadir producto</button></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm"><p className="text-xs text-neutral-400">Productos</p><p className="mt-1 text-2xl font-semibold">{visibleItems.length}</p></div><div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm"><p className="text-xs text-neutral-400">Queda poco</p><p className="mt-1 flex items-center gap-2 text-2xl font-semibold">{lowStockCount}{lowStockCount > 0 && <AlertTriangle size={17} className="text-amber-500" />}</p></div><div className="col-span-2 rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm sm:col-span-1"><p className="text-xs text-neutral-400">Categorías</p><p className="mt-1 text-2xl font-semibold">{new Set(visibleItems.map((item) => item.ingredient.category ?? 'Otros')).size}</p></div></div>
    <div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o categoría" className="w-full rounded-2xl border border-neutral-200 bg-white py-3 pl-11 pr-4 text-sm shadow-sm outline-none focus:border-neutral-400" /></div>
    {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {loading ? <div className="rounded-3xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 shadow-sm">Cargando despensa...</div> : filteredItems.length === 0 ? <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-sm"><PackageOpen className="mx-auto text-neutral-300" size={32} /><h2 className="mt-4 text-lg font-semibold">{visibleItems.length ? 'No hay resultados' : 'No hay productos con existencias'}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-neutral-500">Los productos con cantidad 0 o estado “No tengo” se ocultan automáticamente. Puedes volver a añadirlos cuando repongas existencias.</p>{!visibleItems.length && <button onClick={openCreate} className="mt-5 rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white">Añadir producto</button>}</div> : <div className="grid items-start gap-4 xl:grid-cols-2">{groupedItems.map(([category, categoryItems]) => <section key={category} className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-3"><h2 className="text-sm font-semibold text-neutral-800">{category}</h2><span className="rounded-full bg-white px-2 py-0.5 text-xs text-neutral-400">{categoryItems.length}</span></div><div className="divide-y divide-neutral-100">{categoryItems.sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name, 'es')).map((item) => { const statusLabel = statuses.find((status) => status.value === item.status)?.label; return <article key={item.id} className="flex items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-medium text-neutral-900">{item.ingredient.name}</h3>{item.status === 'queda_poco' && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Queda poco</span>}</div>{item.notes && <p className="mt-0.5 truncate text-xs text-neutral-400">{item.notes}</p>}</div><div className="shrink-0 text-right">{item.quantity !== null && item.unit ? <p className="text-sm font-semibold text-neutral-800">{formatQuantity(item.quantity)} <span className="font-normal text-neutral-400">{item.unit}</span></p> : <p className="text-xs font-medium text-emerald-700">{statusLabel ?? 'Tengo'}</p>}</div><div className="flex shrink-0"><button onClick={() => openEdit(item)} className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Editar"><Pencil size={15} /></button><button onClick={() => void deleteItem(item)} className="rounded-lg p-2 text-neutral-300 hover:bg-red-50 hover:text-red-600" aria-label="Eliminar"><Trash2 size={15} /></button></div></article> })}</div></section>)}</div>}
  </div>
}

export default PantrySection
