import { AlertTriangle, Check, ChevronLeft, ChevronRight, Plus, RefreshCw, ShoppingBasket, Trash2 } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const units = ['g', 'kg', 'ml', 'l', 'unidad', 'cucharada', 'cucharadita', 'taza', 'lata', 'paquete'] as const
type Unit = (typeof units)[number]

type Ingredient = {
  id: string
  name: string
  category: string | null
  default_unit: Unit | null
}

type ShoppingItem = {
  id: string
  ingredient_id: string | null
  manual_name: string | null
  quantity: number | null
  unit: Unit | null
  pantry_check_required: boolean
  checked: boolean
  added_to_pantry: boolean
  ingredient: Ingredient | null
}

type PantryItem = {
  id: string
  ingredient_id: string
  quantity: number | null
  unit: Unit | null
  status: 'tengo' | 'queda_poco' | 'no_tengo' | null
}

type RequiredItem = {
  ingredient: Ingredient
  quantityBase: number
  baseUnit: Unit
  pantryCheckRequired: boolean
}

const categoryOrder = [
  'Fruta y verdura',
  'Carne',
  'Pescado y marisco',
  'Lácteos y huevos',
  'Panadería',
  'Despensa',
  'Congelados',
  'Bebidas',
  'Salsas y condimentos',
  'Otros',
]

function startOfWeek(date: Date) {
  const next = new Date(date)
  const day = next.getDay() || 7
  next.setHours(12, 0, 0, 0)
  next.setDate(next.getDate() - day + 1)
  return next
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function isoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatWeek(start: Date) {
  const end = addDays(start, 6)
  const formatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
  return `${formatter.format(start)} – ${formatter.format(end)}`
}

function toBase(quantity: number, unit: Unit): { quantity: number; unit: Unit } {
  if (unit === 'kg') return { quantity: quantity * 1000, unit: 'g' }
  if (unit === 'l') return { quantity: quantity * 1000, unit: 'ml' }
  return { quantity, unit }
}

function fromBase(quantity: number, baseUnit: Unit): { quantity: number; unit: Unit } {
  if (baseUnit === 'g' && quantity >= 1000) return { quantity: quantity / 1000, unit: 'kg' }
  if (baseUnit === 'ml' && quantity >= 1000) return { quantity: quantity / 1000, unit: 'l' }
  return { quantity, unit: baseUnit }
}

function areCompatible(a: Unit, b: Unit) {
  const weight = new Set<Unit>(['g', 'kg'])
  const volume = new Set<Unit>(['ml', 'l'])
  if (weight.has(a) && weight.has(b)) return true
  if (volume.has(a) && volume.has(b)) return true
  return a === b
}

function convertQuantity(quantity: number, from: Unit, to: Unit) {
  if (!areCompatible(from, to)) return null
  const base = toBase(quantity, from)
  if (to === 'kg' && base.unit === 'g') return base.quantity / 1000
  if (to === 'l' && base.unit === 'ml') return base.quantity / 1000
  return base.quantity
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value)
}

function ShoppingSection() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [listId, setListId] = useState<string | null>(null)
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [addingToPantry, setAddingToPantry] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualQuantity, setManualQuantity] = useState('')
  const [manualUnit, setManualUnit] = useState<Unit>('unidad')

  const loadList = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError('')

    const { data: list, error: listError } = await supabase
      .from('shopping_lists')
      .select('id')
      .eq('week_start', isoDate(weekStart))
      .maybeSingle()

    if (listError) {
      setError(listError.message)
      setLoading(false)
      return
    }

    if (!list) {
      setListId(null)
      setItems([])
      setLoading(false)
      return
    }

    setListId(list.id)
    const { data, error: itemsError } = await supabase
      .from('shopping_items')
      .select(`
        id,
        ingredient_id,
        manual_name,
        quantity,
        unit,
        pantry_check_required,
        checked,
        added_to_pantry,
        ingredient:ingredients(id,name,category,default_unit)
      `)
      .eq('shopping_list_id', list.id)
      .order('sort_order')

    if (itemsError) setError(itemsError.message)
    else setItems((data ?? []) as unknown as ShoppingItem[])
    setLoading(false)
  }, [weekStart])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const ensureList = async () => {
    if (!supabase) return null
    if (listId) return listId

    const { data: userData } = await supabase.auth.getUser()
    const userId = userData.user?.id
    if (!userId) throw new Error('No se ha encontrado la sesión de usuario.')

    const { data, error: createError } = await supabase
      .from('shopping_lists')
      .insert({ user_id: userId, week_start: isoDate(weekStart) })
      .select('id')
      .single()

    if (createError) throw createError
    setListId(data.id)
    return data.id as string
  }

  const generateList = async () => {
    if (!supabase) return
    setGenerating(true)
    setError('')
    setMessage('')

    try {
      const start = isoDate(weekStart)
      const end = isoDate(addDays(weekStart, 6))

      const { data: menuData, error: menuError } = await supabase
        .from('menu_entries')
        .select(`
          id,
          is_eating_out,
          menu_entry_recipes(
            servings,
            recipe:recipes(
              id,
              base_servings,
              recipe_ingredients(
                quantity,
                unit,
                ingredient:ingredients(id,name,category,default_unit)
              )
            )
          )
        `)
        .gte('planned_date', start)
        .lte('planned_date', end)
        .eq('is_eating_out', false)

      if (menuError) throw menuError

      const { data: pantryData, error: pantryError } = await supabase
        .from('pantry_items')
        .select('id,ingredient_id,quantity,unit,status')

      if (pantryError) throw pantryError
      const pantry = (pantryData ?? []) as PantryItem[]
      const pantryByIngredient = new Map(pantry.map((item) => [item.ingredient_id, item]))
      const required = new Map<string, RequiredItem>()

      for (const entry of (menuData ?? []) as any[]) {
        for (const menuRecipe of entry.menu_entry_recipes ?? []) {
          const recipe = menuRecipe.recipe
          if (!recipe || !Number(recipe.base_servings)) continue
          const scale = Number(menuRecipe.servings) / Number(recipe.base_servings)

          for (const recipeIngredient of recipe.recipe_ingredients ?? []) {
            const ingredient = recipeIngredient.ingredient as Ingredient | null
            if (!ingredient) continue
            const normalized = toBase(Number(recipeIngredient.quantity) * scale, recipeIngredient.unit as Unit)
            const key = `${ingredient.id}:${normalized.unit}`
            const current = required.get(key)
            required.set(key, {
              ingredient,
              baseUnit: normalized.unit,
              quantityBase: (current?.quantityBase ?? 0) + normalized.quantity,
              pantryCheckRequired: current?.pantryCheckRequired ?? false,
            })
          }
        }
      }

      const generatedRows: Array<{
        ingredient_id: string
        manual_name: null
        quantity: number
        unit: Unit
        pantry_check_required: boolean
        checked: boolean
        added_to_pantry: boolean
        sort_order: number
      }> = []

      let order = 0
      for (const value of required.values()) {
        let quantityNeeded = value.quantityBase
        let pantryCheckRequired = false
        const pantryItem = pantryByIngredient.get(value.ingredient.id)

        if (pantryItem) {
          if (pantryItem.quantity != null && pantryItem.unit) {
            if (areCompatible(pantryItem.unit, value.baseUnit)) {
              const pantryInBase = toBase(Number(pantryItem.quantity), pantryItem.unit)
              quantityNeeded = Math.max(0, quantityNeeded - pantryInBase.quantity)
            } else {
              pantryCheckRequired = true
            }
          } else if (pantryItem.status === 'tengo' || pantryItem.status === 'queda_poco') {
            pantryCheckRequired = true
          }
        }

        if (quantityNeeded <= 0 && !pantryCheckRequired) continue
        const display = fromBase(quantityNeeded, value.baseUnit)
        generatedRows.push({
          ingredient_id: value.ingredient.id,
          manual_name: null,
          quantity: display.quantity,
          unit: display.unit,
          pantry_check_required: pantryCheckRequired,
          checked: false,
          added_to_pantry: false,
          sort_order: order++,
        })
      }

      const id = await ensureList()
      if (!id) return

      const { error: deleteError } = await supabase.from('shopping_items').delete().eq('shopping_list_id', id)
      if (deleteError) throw deleteError

      if (generatedRows.length) {
        const { error: insertError } = await supabase
          .from('shopping_items')
          .insert(generatedRows.map((row) => ({ ...row, shopping_list_id: id })))
        if (insertError) throw insertError
      }

      setMessage(generatedRows.length ? 'Lista generada a partir del menú y la despensa.' : 'No necesitas comprar nada para esta semana.')
      await loadList()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se ha podido generar la lista.')
    } finally {
      setGenerating(false)
    }
  }

  const toggleItem = async (item: ShoppingItem) => {
    if (!supabase) return
    const next = !item.checked
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, checked: next } : candidate))
    const { error: updateError } = await supabase.from('shopping_items').update({ checked: next }).eq('id', item.id)
    if (updateError) {
      setError(updateError.message)
      await loadList()
    }
  }

  const deleteItem = async (id: string) => {
    if (!supabase) return
    const { error: deleteError } = await supabase.from('shopping_items').delete().eq('id', id)
    if (deleteError) setError(deleteError.message)
    else setItems((current) => current.filter((item) => item.id !== id))
  }

  const addManualItem = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !manualName.trim()) return
    setError('')
    try {
      const id = await ensureList()
      if (!id) return
      const quantity = manualQuantity.trim() ? Number(manualQuantity) : null
      const { error: insertError } = await supabase.from('shopping_items').insert({
        shopping_list_id: id,
        manual_name: manualName.trim(),
        ingredient_id: null,
        quantity,
        unit: quantity == null ? null : manualUnit,
        pantry_check_required: false,
        checked: false,
        added_to_pantry: false,
        sort_order: items.length + 1000,
      })
      if (insertError) throw insertError
      setManualName('')
      setManualQuantity('')
      setShowManual(false)
      await loadList()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se ha podido añadir el producto.')
    }
  }

  const addPurchasedToPantry = async () => {
    if (!supabase) return
    const purchased = items.filter((item) => item.checked && !item.added_to_pantry && item.ingredient_id && item.quantity != null && item.unit)
    if (!purchased.length) {
      setMessage('No hay productos nuevos marcados como comprados para añadir a la despensa.')
      return
    }

    setAddingToPantry(true)
    setError('')
    setMessage('')

    try {
      const { data: userData } = await supabase.auth.getUser()
      const userId = userData.user?.id
      if (!userId) throw new Error('No se ha encontrado la sesión de usuario.')

      const { data: pantryData, error: pantryError } = await supabase
        .from('pantry_items')
        .select('id,ingredient_id,quantity,unit,status')
      if (pantryError) throw pantryError

      const pantryByIngredient = new Map(((pantryData ?? []) as PantryItem[]).map((item) => [item.ingredient_id, item]))

      for (const item of purchased) {
        const existing = pantryByIngredient.get(item.ingredient_id!)
        if (existing && existing.quantity != null && existing.unit && areCompatible(item.unit!, existing.unit)) {
          const converted = convertQuantity(Number(item.quantity), item.unit!, existing.unit)
          if (converted == null) continue
          const { error: updateError } = await supabase
            .from('pantry_items')
            .update({ quantity: Number(existing.quantity) + converted, status: null })
            .eq('id', existing.id)
          if (updateError) throw updateError
        } else if (existing) {
          const { error: updateError } = await supabase
            .from('pantry_items')
            .update({ quantity: Number(item.quantity), unit: item.unit, status: null })
            .eq('id', existing.id)
          if (updateError) throw updateError
        } else {
          const { error: insertError } = await supabase.from('pantry_items').insert({
            user_id: userId,
            ingredient_id: item.ingredient_id,
            quantity: Number(item.quantity),
            unit: item.unit,
            status: null,
          })
          if (insertError) throw insertError
        }

        const { error: markError } = await supabase.from('shopping_items').update({ added_to_pantry: true }).eq('id', item.id)
        if (markError) throw markError
      }

      const manualSkipped = items.filter((item) => item.checked && !item.ingredient_id && !item.added_to_pantry).length
      setMessage(`Añadidos ${purchased.length} producto${purchased.length === 1 ? '' : 's'} a la despensa.${manualSkipped ? ` ${manualSkipped} elemento${manualSkipped === 1 ? '' : 's'} manual${manualSkipped === 1 ? '' : 'es'} no se ha añadido automáticamente.` : ''}`)
      await loadList()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se han podido añadir los productos a la despensa.')
    } finally {
      setAddingToPantry(false)
    }
  }

  const groupedItems = useMemo(() => {
    const groups = new Map<string, ShoppingItem[]>()
    for (const item of items) {
      const category = item.ingredient?.category ?? 'Otros'
      const current = groups.get(category) ?? []
      current.push(item)
      groups.set(category, current)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const ai = categoryOrder.indexOf(a)
      const bi = categoryOrder.indexOf(b)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
  }, [items])

  const checkedCount = items.filter((item) => item.checked).length
  const pendingPantryChecks = items.filter((item) => item.pantry_check_required).length

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-500">Semana de compra</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">Lista de la compra</h1>
          <p className="mt-1 text-sm text-neutral-500">{formatWeek(weekStart)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setWeekStart((current) => addDays(current, -7))} className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600"><ChevronLeft size={18} /></button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700">Esta semana</button>
          <button onClick={() => setWeekStart((current) => addDays(current, 7))} className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Productos</p><p className="mt-1 text-2xl font-semibold">{items.length}</p></div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Comprados</p><p className="mt-1 text-2xl font-semibold">{checkedCount}</p></div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Revisar despensa</p><p className="mt-1 text-2xl font-semibold">{pendingPantryChecks}</p></div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => void generateList()} disabled={generating} className="inline-flex items-center gap-2 rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          <RefreshCw size={16} className={generating ? 'animate-spin' : ''} />
          {generating ? 'Generando…' : items.length ? 'Regenerar desde menú' : 'Generar desde menú'}
        </button>
        <button onClick={() => setShowManual((current) => !current)} className="inline-flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700"><Plus size={16} /> Añadir manualmente</button>
        {checkedCount > 0 && (
          <button onClick={() => void addPurchasedToPantry()} disabled={addingToPantry} className="inline-flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 disabled:opacity-50"><ShoppingBasket size={16} /> {addingToPantry ? 'Añadiendo…' : 'Añadir comprados a despensa'}</button>
        )}
      </div>

      {showManual && (
        <form onSubmit={addManualItem} className="grid gap-3 rounded-3xl border border-neutral-200 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_120px_130px_auto]">
          <input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="Producto manual" required className="rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-neutral-400" />
          <input type="number" min="0" step="0.01" value={manualQuantity} onChange={(event) => setManualQuantity(event.target.value)} placeholder="Cantidad" className="rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-neutral-400" />
          <select value={manualUnit} onChange={(event) => setManualUnit(event.target.value as Unit)} className="rounded-xl border border-neutral-200 px-3 py-2.5 text-sm outline-none focus:border-neutral-400">{units.map((unit) => <option key={unit}>{unit}</option>)}</select>
          <button className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white">Añadir</button>
        </form>
      )}

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

      {loading ? (
        <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">Cargando lista…</div>
      ) : items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-neutral-300 bg-white p-8 text-center">
          <ShoppingBasket className="mx-auto text-neutral-300" size={32} />
          <h2 className="mt-3 text-lg font-semibold">Todavía no hay lista</h2>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-neutral-500">Planifica recetas en Menú y pulsa “Generar desde menú”. Se tendrán en cuenta las raciones y la despensa.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedItems.map(([category, categoryItems]) => (
            <section key={category} className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
              <div className="border-b border-neutral-100 px-5 py-3"><h2 className="text-sm font-semibold text-neutral-700">{category}</h2></div>
              <div className="divide-y divide-neutral-100">
                {categoryItems.map((item) => (
                  <div key={item.id} className={`flex items-center gap-3 px-4 py-3 sm:px-5 ${item.checked ? 'bg-neutral-50' : ''}`}>
                    <button onClick={() => void toggleItem(item)} className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border transition ${item.checked ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white'}`} aria-label={item.checked ? 'Marcar como pendiente' : 'Marcar como comprado'}>{item.checked && <Check size={15} />}</button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`text-sm font-medium ${item.checked ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>{item.ingredient?.name ?? item.manual_name}</p>
                        {item.pantry_check_required && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"><AlertTriangle size={11} /> Revisar despensa</span>}
                        {item.added_to_pantry && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">En despensa</span>}
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-400">{item.quantity != null && item.unit ? `${formatQuantity(Number(item.quantity))} ${item.unit}` : 'Sin cantidad'}</p>
                    </div>
                    <button onClick={() => void deleteItem(item.id)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-neutral-300 hover:bg-red-50 hover:text-red-500" aria-label="Eliminar"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

export default ShoppingSection
