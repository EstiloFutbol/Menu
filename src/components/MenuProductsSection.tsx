import { ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const mealTypes = [
  { id: 'desayuno', label: 'Desayuno' },
  { id: 'almuerzo', label: 'Almuerzo' },
  { id: 'comida', label: 'Comida' },
  { id: 'merienda', label: 'Merienda' },
  { id: 'cena', label: 'Cena' },
] as const

type MealType = (typeof mealTypes)[number]['id']
type Unit = 'g' | 'kg' | 'ml' | 'l' | 'unidad' | 'cucharada' | 'cucharadita' | 'taza' | 'lata' | 'paquete'

const units: Unit[] = ['g', 'kg', 'ml', 'l', 'unidad', 'cucharada', 'cucharadita', 'taza', 'lata', 'paquete']
const dayLabels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

type Ingredient = { id: string; name: string; category: string | null; default_unit: Unit | null }
type PlannedProduct = { id: string; menu_entry_id: string; ingredient_id: string; quantity: number; unit: Unit; sort_order: number; ingredient: Ingredient | null }
type MenuEntry = { id: string; planned_date: string; meal: MealType; is_eating_out?: boolean }
type Draft = { date: string; meal: MealType; ingredientId: string; quantity: string; unit: Unit }

function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = result.getDay() || 7
  result.setDate(result.getDate() - day + 1)
  return result
}
function addDays(date: Date, days: number) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() + days)
  return result
}
function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}
function formatWeek(start: Date) {
  const end = addDays(start, 6)
  const formatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
  return `${formatter.format(start)} – ${formatter.format(end)}`
}
function formatQuantity(value: number) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value)
}

export default function MenuProductsSection() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [entries, setEntries] = useState<MenuEntry[]>([])
  const [products, setProducts] = useState<PlannedProduct[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index)
    return { date: dateString(date), label: dayLabels[index] }
  }), [weekStart])

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError('')
    try {
      const from = dateString(weekStart)
      const to = dateString(addDays(weekStart, 6))
      const [ingredientResult, entryResult] = await Promise.all([
        supabase.from('ingredients').select('id,name,category,default_unit').order('name'),
        supabase.from('menu_entries').select('id,planned_date,meal,is_eating_out').gte('planned_date', from).lte('planned_date', to).order('planned_date'),
      ])
      if (ingredientResult.error) throw ingredientResult.error
      if (entryResult.error) throw entryResult.error
      const entryData = (entryResult.data ?? []) as MenuEntry[]
      setIngredients((ingredientResult.data ?? []) as Ingredient[])
      setEntries(entryData)

      const entryIds = entryData.map((entry) => entry.id)
      if (!entryIds.length) {
        setProducts([])
        return
      }
      const { data, error: productError } = await supabase
        .from('menu_entry_products')
        .select('id,menu_entry_id,ingredient_id,quantity,unit,sort_order,ingredient:ingredients(id,name,category,default_unit)')
        .in('menu_entry_id', entryIds)
        .order('sort_order')
      if (productError) throw productError
      setProducts((data ?? []) as unknown as PlannedProduct[])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los productos del menú.')
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => { void load() }, [load])

  const entryBySlot = useMemo(() => new Map(entries.map((entry) => [`${entry.planned_date}:${entry.meal}`, entry])), [entries])
  const productsByEntry = useMemo(() => {
    const map = new Map<string, PlannedProduct[]>()
    products.forEach((product) => {
      const current = map.get(product.menu_entry_id) ?? []
      current.push(product)
      map.set(product.menu_entry_id, current)
    })
    return map
  }, [products])

  const openAdd = async (date: string, meal: MealType) => {
    if (!supabase) return
    setError('')
    let existing = entryBySlot.get(`${date}:${meal}`)
    if (existing?.is_eating_out) {
      setError('Esta franja está marcada como comida fuera. Cámbiala primero a una comida normal.')
      return
    }
    if (!existing) {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) { setError('No se ha encontrado la sesión de usuario.'); return }
      const { data, error: insertError } = await supabase
        .from('menu_entries')
        .insert({ user_id: userData.user.id, planned_date: date, meal, is_eating_out: false })
        .select('id,planned_date,meal,is_eating_out')
        .single()
      if (insertError) { setError(insertError.message); return }
      existing = data as MenuEntry
      setEntries((current) => [...current, existing!])
    }
    setDraft({ date, meal, ingredientId: '', quantity: '1', unit: existing ? 'unidad' : 'unidad' })
  }

  const saveProduct = async () => {
    if (!supabase || !draft) return
    const entry = entryBySlot.get(`${draft.date}:${draft.meal}`) ?? entries.find((item) => item.planned_date === draft.date && item.meal === draft.meal)
    const quantity = Number(draft.quantity)
    if (!entry) { setError('No existe la franja seleccionada.'); return }
    if (!draft.ingredientId || !Number.isFinite(quantity) || quantity <= 0) { setError('Selecciona un producto e indica una cantidad válida.'); return }

    const duplicate = products.some((item) => item.menu_entry_id === entry.id && item.ingredient_id === draft.ingredientId)
    if (duplicate) { setError('Ese producto ya está añadido a esta comida. Elige otro.'); return }

    setSaving(true)
    setError('')
    const { error: insertError } = await supabase.from('menu_entry_products').insert({
      menu_entry_id: entry.id,
      ingredient_id: draft.ingredientId,
      quantity,
      unit: draft.unit,
      sort_order: (productsByEntry.get(entry.id)?.length ?? 0),
    })
    setSaving(false)
    if (insertError) { setError(insertError.message); return }
    setDraft(null)
    await load()
  }

  const deleteProduct = async (productId: string) => {
    if (!supabase) return
    const { error: deleteError } = await supabase.from('menu_entry_products').delete().eq('id', productId)
    if (deleteError) setError(deleteError.message)
    else setProducts((current) => current.filter((product) => product.id !== productId))
  }

  return (
    <section className="mt-8 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-500">Productos directos</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-neutral-950">Sin receta</h2>
          <p className="mt-1 text-sm text-neutral-500">Yogur, fruta, frutos secos, pan o cualquier producto que quieras consumir directamente.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="grid h-9 w-9 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm"><ChevronLeft size={17} /></button>
          <span className="min-w-32 text-center text-sm text-neutral-600">{formatWeek(weekStart)}</span>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="grid h-9 w-9 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm"><ChevronRight size={17} /></button>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? <div className="rounded-3xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 shadow-sm">Cargando productos…</div> : (
        <div className="grid gap-4 xl:grid-cols-2">
          {days.map((day) => (
            <section key={day.date} className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div><h3 className="text-lg font-semibold text-neutral-900">{day.label}</h3><p className="mt-0.5 text-xs text-neutral-400">{new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(parseDate(day.date))}</p></div>
                <Plus size={18} className="text-neutral-300" />
              </div>
              <div className="mt-4 divide-y divide-neutral-100">
                {mealTypes.map((meal) => {
                  const entry = entryBySlot.get(`${day.date}:${meal.id}`)
                  const planned = entry ? (productsByEntry.get(entry.id) ?? []) : []
                  return (
                    <div key={meal.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-neutral-800">{meal.label}</p>
                          {planned.length > 0 ? <div className="mt-2 space-y-1.5">{planned.map((product) => (
                            <div key={product.id} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2">
                              <p className="truncate text-xs font-medium text-neutral-700">{product.ingredient?.name ?? 'Producto'}</p>
                              <div className="flex shrink-0 items-center gap-2"><span className="text-[11px] text-neutral-400">{formatQuantity(Number(product.quantity))} {product.unit}</span><button onClick={() => void deleteProduct(product.id)} className="text-neutral-300 hover:text-red-500" aria-label="Eliminar producto"><Trash2 size={13} /></button></div>
                            </div>
                          ))}</div> : <p className="mt-1 text-xs text-neutral-400">Sin productos directos</p>}
                        </div>
                        <button onClick={() => void openAdd(day.date, meal.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50" aria-label={`Añadir producto a ${meal.label}`}><Plus size={15} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-neutral-950/30 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><p className="text-sm text-neutral-500">{mealTypes.find((meal) => meal.id === draft.meal)?.label}</p><h3 className="mt-1 text-xl font-semibold text-neutral-950">Añadir producto</h3></div><button onClick={() => setDraft(null)} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-100"><X size={18} /></button></div>
            <div className="mt-5 space-y-4">
              <label className="block"><span className="text-xs font-medium text-neutral-600">Producto</span><select value={draft.ingredientId} onChange={(event) => { const ingredient = ingredients.find((item) => item.id === event.target.value); setDraft((current) => current ? { ...current, ingredientId: event.target.value, unit: ingredient?.default_unit ?? current.unit } : current) }} className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm"><option value="">Selecciona un producto…</option>{ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3"><label className="block"><span className="text-xs font-medium text-neutral-600">Cantidad</span><input type="number" min="0.01" step="0.01" value={draft.quantity} onChange={(event) => setDraft((current) => current ? { ...current, quantity: event.target.value } : current)} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm" /></label><label className="block"><span className="text-xs font-medium text-neutral-600">Unidad</span><select value={draft.unit} onChange={(event) => setDraft((current) => current ? { ...current, unit: event.target.value as Unit } : current)} className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm">{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label></div>
              <div className="flex gap-2 pt-2"><button onClick={() => setDraft(null)} className="flex-1 rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700">Cancelar</button><button onClick={() => void saveProduct()} disabled={saving} className="flex-1 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Añadir producto'}</button></div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
