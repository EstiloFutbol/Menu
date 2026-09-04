import { CheckCircle2, ChevronLeft, ChevronRight, LockKeyhole, Plus, Trash2, UtensilsCrossed, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDays, localDateString, startOfWeek } from '../lib/domain'
import { supabase } from '../lib/supabase'
import CompleteProductModal from './CompleteProductModal'
import CompleteRecipeModal from './CompleteRecipeModal'

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
type Recipe = { id: string; name: string; base_servings: number }
type Ingredient = { id: string; name: string; category: string | null; default_unit: Unit | null }
type PlannedRecipe = { id: string; recipe_id: string; servings: number; sort_order: number; recipe: { id: string; name: string } | null }
type PlannedProduct = { id: string; ingredient_id: string; quantity: number; unit: Unit; sort_order: number; ingredient: Ingredient | null }
type ConsumptionLog = { id: string; recipe_id: string | null; menu_entry_product_id: string | null; consumed_at: string }
type MenuEntry = { id: string; planned_date: string; meal: MealType; is_eating_out: boolean; completed_at: string | null; menu_entry_recipes: PlannedRecipe[]; menu_entry_products: PlannedProduct[]; consumption_logs: ConsumptionLog[] }
type SlotDraftRecipe = { rowId?: string; recipeId: string; servings: string; locked?: boolean }
type SlotDraftProduct = { rowId?: string; ingredientId: string; quantity: string; unit: Unit; locked?: boolean }
type SlotDraft = { date: string; meal: MealType; mode: 'normal' | 'eating_out'; recipes: SlotDraftRecipe[]; products: SlotDraftProduct[] }
type RecipeCompletion = { kind: 'recipe'; entryId: string; recipeId: string; recipeName: string; servings: number }
type ProductCompletion = { kind: 'product'; entryId: string; productId: string; productName: string; quantity: number; unit: Unit }
type CompletionTarget = RecipeCompletion | ProductCompletion

const dayLabels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
function parseLocalDate(value: string) { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day) }
function formatShortDate(value: string) { return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(parseLocalDate(value)) }
function formatWeekRange(start: Date) { const formatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }); return `${formatter.format(start)} – ${formatter.format(addDays(start, 6))}` }
function slotKey(date: string, meal: MealType) { return `${date}:${meal}` }
function formatQuantity(value: number) { return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(value) }

export default function MenuSection() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [mobileDay, setMobileDay] = useState(() => Math.max(0, Math.min(6, (new Date().getDay() || 7) - 1)))
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [entries, setEntries] = useState<MenuEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<SlotDraft | null>(null)
  const [completionTarget, setCompletionTarget] = useState<CompletionTarget | null>(null)

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => { const date = addDays(weekStart, index); return { date: localDateString(date), label: dayLabels[index] } }), [weekStart])
  const entriesBySlot = useMemo(() => { const map = new Map<string, MenuEntry>(); entries.forEach((entry) => map.set(slotKey(entry.planned_date, entry.meal), entry)); return map }, [entries])

  const loadRecipes = useCallback(async () => { if (!supabase) return; const { data, error: queryError } = await supabase.from('recipes').select('id,name,base_servings').order('name'); if (queryError) throw queryError; setRecipes((data ?? []) as Recipe[]) }, [])
  const loadIngredients = useCallback(async () => { if (!supabase) return; const { data, error: queryError } = await supabase.from('ingredients').select('id,name,category,default_unit').order('name'); if (queryError) throw queryError; setIngredients((data ?? []) as Ingredient[]) }, [])
  const loadWeek = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError('')
    try {
      const from = localDateString(weekStart); const to = localDateString(addDays(weekStart, 6))
      const { data, error: queryError } = await supabase.from('menu_entries').select('id,planned_date,meal,is_eating_out,completed_at,menu_entry_recipes(id,recipe_id,servings,sort_order,recipe:recipes(id,name)),menu_entry_products(id,ingredient_id,quantity,unit,sort_order,ingredient:ingredients(id,name,category,default_unit)),consumption_logs(id,recipe_id,menu_entry_product_id,consumed_at)').gte('planned_date', from).lte('planned_date', to).order('planned_date')
      if (queryError) throw queryError
      setEntries((data ?? []) as unknown as MenuEntry[])
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar el menú.') } finally { setLoading(false) }
  }, [weekStart])

  useEffect(() => { void loadRecipes().catch((cause) => setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las recetas.')); void loadIngredients().catch((cause) => setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los productos.')) }, [loadRecipes, loadIngredients])
  useEffect(() => { void loadWeek() }, [loadWeek])

  const openSlot = (date: string, meal: MealType) => {
    const current = entriesBySlot.get(slotKey(date, meal))
    const completedRecipeIds = new Set(current?.consumption_logs?.map((log) => log.recipe_id).filter(Boolean) as string[] ?? [])
    const completedProductIds = new Set(current?.consumption_logs?.map((log) => log.menu_entry_product_id).filter(Boolean) as string[] ?? [])
    setDraft({
      date,
      meal,
      mode: current?.is_eating_out ? 'eating_out' : 'normal',
      recipes: current?.menu_entry_recipes?.slice().sort((a, b) => a.sort_order - b.sort_order).map((item) => ({ rowId: item.id, recipeId: item.recipe_id, servings: String(item.servings), locked: completedRecipeIds.has(item.recipe_id) })) ?? [],
      products: current?.menu_entry_products?.slice().sort((a, b) => a.sort_order - b.sort_order).map((item) => ({ rowId: item.id, ingredientId: item.ingredient_id, quantity: String(item.quantity), unit: item.unit, locked: completedProductIds.has(item.id) })) ?? [],
    })
    setError('')
  }

  const saveSlot = async () => {
    if (!supabase || !draft) return
    const current = entriesBySlot.get(slotKey(draft.date, draft.meal))
    const hasConsumption = (current?.consumption_logs?.length ?? 0) > 0
    if (draft.mode === 'eating_out' && hasConsumption) { setError('No puedes convertir en “Comida fuera” una franja que ya tiene consumos registrados.'); return }

    const validRecipes = draft.recipes.filter((item) => item.recipeId && Number(item.servings) > 0)
    const validProducts = draft.products.filter((item) => item.ingredientId && Number(item.quantity) > 0)
    if (draft.mode === 'normal' && draft.recipes.some((item) => !item.recipeId || Number(item.servings) <= 0)) { setError('Revisa las recetas y raciones antes de guardar.'); return }
    if (draft.mode === 'normal' && draft.products.some((item) => !item.ingredientId || Number(item.quantity) <= 0)) { setError('Revisa los productos y cantidades antes de guardar.'); return }

    setSaving(true); setError('')
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser(); if (userError || !userData.user) throw userError ?? new Error('No se ha encontrado la sesión.')
      let entryId = current?.id

      if (!current && draft.mode === 'normal' && validRecipes.length === 0 && validProducts.length === 0) { setDraft(null); return }
      if (current) {
        const { error: updateError } = await supabase.from('menu_entries').update({ is_eating_out: draft.mode === 'eating_out' }).eq('id', current.id)
        if (updateError) throw updateError
      } else {
        const { data: inserted, error: insertError } = await supabase.from('menu_entries').insert({ user_id: userData.user.id, planned_date: draft.date, meal: draft.meal, is_eating_out: draft.mode === 'eating_out' }).select('id').single()
        if (insertError) throw insertError
        entryId = inserted.id
      }
      if (!entryId) throw new Error('No se pudo guardar la franja del menú.')

      if (current) {
        const removableRecipeIds = current.menu_entry_recipes.filter((item) => !current.consumption_logs.some((log) => log.recipe_id === item.recipe_id)).map((item) => item.id)
        const removableProductIds = current.menu_entry_products.filter((item) => !current.consumption_logs.some((log) => log.menu_entry_product_id === item.id)).map((item) => item.id)
        if (removableRecipeIds.length) { const { error: deleteError } = await supabase.from('menu_entry_recipes').delete().in('id', removableRecipeIds); if (deleteError) throw deleteError }
        if (removableProductIds.length) { const { error: deleteError } = await supabase.from('menu_entry_products').delete().in('id', removableProductIds); if (deleteError) throw deleteError }
      }

      const newRecipes = draft.mode === 'normal' ? validRecipes.filter((item) => !item.locked) : []
      const newProducts = draft.mode === 'normal' ? validProducts.filter((item) => !item.locked) : []
      const recipeIds = new Set<string>()
      for (const item of validRecipes) { if (recipeIds.has(item.recipeId)) throw new Error('Una misma receta no puede añadirse dos veces en la misma comida.'); recipeIds.add(item.recipeId) }
      const ingredientIds = new Set<string>()
      for (const item of validProducts) { if (ingredientIds.has(item.ingredientId)) throw new Error('Un mismo producto no puede añadirse dos veces en la misma comida.'); ingredientIds.add(item.ingredientId) }

      if (newRecipes.length) { const { error: insertError } = await supabase.from('menu_entry_recipes').insert(newRecipes.map((item, index) => ({ menu_entry_id: entryId, recipe_id: item.recipeId, servings: Number(item.servings), sort_order: index + draft.recipes.filter((candidate) => candidate.locked).length }))); if (insertError) throw insertError }
      if (newProducts.length) { const { error: insertError } = await supabase.from('menu_entry_products').insert(newProducts.map((item, index) => ({ menu_entry_id: entryId, ingredient_id: item.ingredientId, quantity: Number(item.quantity), unit: item.unit, sort_order: index + draft.products.filter((candidate) => candidate.locked).length }))); if (insertError) throw insertError }

      const plannedCount = draft.mode === 'normal' ? validRecipes.length + validProducts.length : 0
      const completedCount = current?.consumption_logs?.length ?? 0
      const completedAt = plannedCount > 0 && completedCount >= plannedCount ? current?.completed_at ?? new Date().toISOString() : null
      const { error: completionError } = await supabase.from('menu_entries').update({ completed_at: completedAt }).eq('id', entryId)
      if (completionError) throw completionError

      if (draft.mode === 'normal' && plannedCount === 0 && !hasConsumption) {
        const { error: deleteError } = await supabase.from('menu_entries').delete().eq('id', entryId)
        if (deleteError) throw deleteError
      }

      setDraft(null); await loadWeek()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el menú.') } finally { setSaving(false) }
  }

  const clearSlot = async () => {
    if (!supabase || !draft) return
    const current = entriesBySlot.get(slotKey(draft.date, draft.meal))
    if (!current) { setDraft(null); return }
    setSaving(true); setError('')
    try {
      const hasConsumption = current.consumption_logs.length > 0
      if (!hasConsumption) {
        const { error: deleteError } = await supabase.from('menu_entries').delete().eq('id', current.id)
        if (deleteError) throw deleteError
      } else {
        const recipeIds = current.menu_entry_recipes.filter((item) => !current.consumption_logs.some((log) => log.recipe_id === item.recipe_id)).map((item) => item.id)
        const productIds = current.menu_entry_products.filter((item) => !current.consumption_logs.some((log) => log.menu_entry_product_id === item.id)).map((item) => item.id)
        if (recipeIds.length) { const { error } = await supabase.from('menu_entry_recipes').delete().in('id', recipeIds); if (error) throw error }
        if (productIds.length) { const { error } = await supabase.from('menu_entry_products').delete().in('id', productIds); if (error) throw error }
        const { error } = await supabase.from('menu_entries').update({ completed_at: current.completed_at ?? new Date().toISOString() }).eq('id', current.id); if (error) throw error
      }
      setDraft(null); await loadWeek()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar la franja.') } finally { setSaving(false) }
  }

  const selectedMealLabel = draft ? mealTypes.find((item) => item.id === draft.meal)?.label : ''

  const renderSlotContents = (day: { date: string; label: string }, meal: (typeof mealTypes)[number], compact = false) => {
    const entry = entriesBySlot.get(slotKey(day.date, meal.id))
    const planned = entry?.menu_entry_recipes?.slice().sort((a, b) => a.sort_order - b.sort_order) ?? []
    const products = entry?.menu_entry_products?.slice().sort((a, b) => a.sort_order - b.sort_order) ?? []
    if (entry?.is_eating_out) return <p className="flex items-center gap-1 text-xs font-medium text-neutral-500"><UtensilsCrossed size={12} /> Fuera</p>
    if (!planned.length && !products.length) return <p className="text-xs text-neutral-300">Añadir</p>
    return <div className="space-y-1.5">{planned.map((item) => { const completed = entry?.consumption_logs?.some((log) => log.recipe_id === item.recipe_id) ?? false; return <div key={item.id} className={`rounded-lg ${compact ? '' : 'bg-neutral-50 px-2 py-1.5'}`}><div className="flex items-center gap-1"><p className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-700">{item.recipe?.name ?? 'Receta'}</p>{completed && <CheckCircle2 size={12} className="shrink-0 text-emerald-600" />}</div>{!compact && <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[11px] text-neutral-400">{Number(item.servings).toLocaleString('es-ES')} r.</span>{!completed && <button onClick={(event) => { event.stopPropagation(); setCompletionTarget({ kind: 'recipe', entryId: entry!.id, recipeId: item.recipe_id, recipeName: item.recipe?.name ?? 'Receta', servings: Number(item.servings) }) }} className="text-[11px] font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-2">Completar</button>}</div>}</div> })}{products.map((item) => { const completed = entry?.consumption_logs?.some((log) => log.menu_entry_product_id === item.id) ?? false; return <div key={item.id} className={`rounded-lg ${compact ? '' : 'bg-neutral-50 px-2 py-1.5'}`}><div className="flex items-center gap-1"><p className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-700">{item.ingredient?.name ?? 'Producto'}</p>{completed && <CheckCircle2 size={12} className="shrink-0 text-emerald-600" />}</div>{!compact && <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[11px] text-neutral-400">{formatQuantity(Number(item.quantity))} {item.unit}</span>{!completed && <button onClick={(event) => { event.stopPropagation(); setCompletionTarget({ kind: 'product', entryId: entry!.id, productId: item.id, productName: item.ingredient?.name ?? 'Producto', quantity: Number(item.quantity), unit: item.unit }) }} className="text-[11px] font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-2">Completar</button>}</div>}</div> })}</div>
  }

  return <div className="space-y-5">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-neutral-500">Planificación semanal</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">Tu menú</h1><p className="mt-2 text-sm text-neutral-500">{formatWeekRange(weekStart)}</p></div><div className="flex gap-2"><button onClick={() => setWeekStart(addDays(weekStart, -7))} className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm" aria-label="Semana anterior"><ChevronLeft size={18} /></button><button onClick={() => { setWeekStart(startOfWeek(new Date())); setMobileDay(Math.max(0, Math.min(6, (new Date().getDay() || 7) - 1))) }} className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm">Esta semana</button><button onClick={() => setWeekStart(addDays(weekStart, 7))} className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm" aria-label="Semana siguiente"><ChevronRight size={18} /></button></div></header>
    {error && !draft && !completionTarget && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {loading ? <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-sm text-neutral-500 shadow-sm">Cargando menú…</div> : <>
      <div className="lg:hidden">
        <div className="grid grid-cols-7 gap-1 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-sm">{weekDays.map((day, index) => { const today = day.date === localDateString(new Date()); return <button key={day.date} onClick={() => setMobileDay(index)} className={`rounded-xl px-1 py-2 text-center ${mobileDay === index ? 'bg-neutral-900 text-white' : 'text-neutral-500'}`}><span className="block text-[10px] font-medium">{day.label.slice(0, 2)}</span><span className="mt-0.5 block text-xs font-semibold">{parseLocalDate(day.date).getDate()}</span>{today && <span className={`mx-auto mt-1 block h-1 w-1 rounded-full ${mobileDay === index ? 'bg-white' : 'bg-neutral-900'}`} />}</button> })}</div>
        <section className="mt-3 overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm"><div className="border-b border-neutral-100 px-4 py-3"><h2 className="font-semibold">{weekDays[mobileDay].label}</h2><p className="text-xs text-neutral-400">{formatShortDate(weekDays[mobileDay].date)}</p></div><div className="divide-y divide-neutral-100">{mealTypes.map((meal) => <button key={meal.id} onClick={() => openSlot(weekDays[mobileDay].date, meal.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left"><span className="w-20 shrink-0 pt-0.5 text-xs font-semibold text-neutral-500">{meal.label}</span><div className="min-w-0 flex-1">{renderSlotContents(weekDays[mobileDay], meal)}</div></button>)}</div></section>
      </div>
      <div className="hidden overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm lg:block"><div className="grid grid-cols-[110px_repeat(7,minmax(0,1fr))] border-b border-neutral-200 bg-neutral-50"><div className="p-3" />{weekDays.map((day) => { const today = day.date === localDateString(new Date()); return <div key={day.date} className={`border-l border-neutral-200 p-3 text-center ${today ? 'bg-white' : ''}`}><p className="text-xs font-semibold text-neutral-700">{day.label}</p><p className="mt-0.5 text-[11px] text-neutral-400">{formatShortDate(day.date)}{today ? ' · Hoy' : ''}</p></div> })}</div>{mealTypes.map((meal) => <div key={meal.id} className="grid grid-cols-[110px_repeat(7,minmax(0,1fr))] border-b border-neutral-100 last:border-0"><div className="flex items-center px-3 py-3 text-xs font-semibold text-neutral-500">{meal.label}</div>{weekDays.map((day) => { const entry = entriesBySlot.get(slotKey(day.date, meal.id)); return <button key={day.date} onClick={() => openSlot(day.date, meal.id)} className="min-h-24 border-l border-neutral-100 p-2.5 text-left transition hover:bg-neutral-50"><div className="flex items-start justify-between gap-1">{renderSlotContents(day, meal, true)}{entry?.completed_at && <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />}</div></button> })}</div>)}</div>
    </>}

    {draft && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && !saving && setDraft(null)}><div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-neutral-500">{formatShortDate(draft.date)}</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">{selectedMealLabel}</h2></div><button disabled={saving} onClick={() => setDraft(null)} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-100" aria-label="Cerrar"><X size={19} /></button></div><div className="mt-6 grid grid-cols-2 rounded-2xl bg-neutral-100 p-1"><button onClick={() => setDraft({ ...draft, mode: 'normal' })} className={`rounded-xl px-3 py-2 text-sm font-medium ${draft.mode === 'normal' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>Comida</button><button disabled={draft.recipes.some((item) => item.locked) || draft.products.some((item) => item.locked)} onClick={() => setDraft({ ...draft, mode: 'eating_out', recipes: [], products: [] })} className={`rounded-xl px-3 py-2 text-sm font-medium disabled:opacity-40 ${draft.mode === 'eating_out' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>Comida fuera</button></div>{draft.mode === 'eating_out' ? <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-600">Esta franja no añadirá ingredientes a la lista de la compra ni descontará productos de la despensa.</div> : <div className="mt-5 space-y-6"><section><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-neutral-900">Recetas</h3><p className="mt-0.5 text-xs text-neutral-400">Lo ya consumido queda protegido; puedes editar el resto.</p></div><button onClick={() => setDraft({ ...draft, recipes: [...draft.recipes, { recipeId: '', servings: '1' }] })} className="flex items-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700"><Plus size={14} /> Añadir</button></div>{draft.recipes.length ? <div className="mt-3 space-y-2">{draft.recipes.map((item, index) => <div key={item.rowId ?? `new-recipe-${index}`} className={`grid grid-cols-[minmax(0,1fr)_90px_40px] gap-2 rounded-2xl border p-3 ${item.locked ? 'border-emerald-100 bg-emerald-50/50' : 'border-neutral-200 bg-neutral-50'}`}><div><label className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-500">Receta {item.locked && <LockKeyhole size={11} />}</label><select disabled={item.locked} value={item.recipeId} onChange={(event) => { const next = [...draft.recipes]; next[index] = { ...next[index], recipeId: event.target.value }; setDraft({ ...draft, recipes: next }) }} className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm disabled:bg-transparent">{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}<option value="">Seleccionar…</option></select></div><div><label className="mb-1 block text-xs font-medium text-neutral-500">Raciones</label><input disabled={item.locked} type="number" min="0.25" step="0.25" value={item.servings} onChange={(event) => { const next = [...draft.recipes]; next[index] = { ...next[index], servings: event.target.value }; setDraft({ ...draft, recipes: next }) }} className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm disabled:bg-transparent" /></div>{item.locked ? <div className="mt-5 grid h-10 w-10 place-items-center text-emerald-600"><CheckCircle2 size={17} /></div> : <button onClick={() => setDraft({ ...draft, recipes: draft.recipes.filter((_, recipeIndex) => recipeIndex !== index) })} className="mt-5 grid h-10 w-10 place-items-center rounded-xl text-neutral-400 hover:text-red-500"><Trash2 size={17} /></button>}</div>)}</div> : <p className="mt-3 text-xs text-neutral-400">Sin recetas.</p>}</section><section><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-neutral-900">Productos</h3><p className="mt-0.5 text-xs text-neutral-400">Alimentos que consumes directamente.</p></div><button onClick={() => setDraft({ ...draft, products: [...draft.products, { ingredientId: '', quantity: '1', unit: 'unidad' }] })} className="flex items-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700"><Plus size={14} /> Añadir</button></div>{draft.products.length ? <div className="mt-3 space-y-2">{draft.products.map((item, index) => <div key={item.rowId ?? `new-product-${index}`} className={`grid grid-cols-[minmax(0,1fr)_80px_105px_40px] gap-2 rounded-2xl border p-3 ${item.locked ? 'border-emerald-100 bg-emerald-50/50' : 'border-neutral-200 bg-neutral-50'}`}><div><label className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-500">Producto {item.locked && <LockKeyhole size={11} />}</label><select disabled={item.locked} value={item.ingredientId} onChange={(event) => { const ingredient = ingredients.find((candidate) => candidate.id === event.target.value); const next = [...draft.products]; next[index] = { ...next[index], ingredientId: event.target.value, unit: ingredient?.default_unit ?? next[index].unit }; setDraft({ ...draft, products: next }) }} className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm disabled:bg-transparent"><option value="">Seleccionar…</option>{ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}</select></div><div><label className="mb-1 block text-xs font-medium text-neutral-500">Cantidad</label><input disabled={item.locked} type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => { const next = [...draft.products]; next[index] = { ...next[index], quantity: event.target.value }; setDraft({ ...draft, products: next }) }} className="w-full rounded-xl border border-neutral-200 bg-white px-2 py-2.5 text-sm disabled:bg-transparent" /></div><div><label className="mb-1 block text-xs font-medium text-neutral-500">Unidad</label><select disabled={item.locked} value={item.unit} onChange={(event) => { const next = [...draft.products]; next[index] = { ...next[index], unit: event.target.value as Unit }; setDraft({ ...draft, products: next }) }} className="w-full rounded-xl border border-neutral-200 bg-white px-2 py-2.5 text-sm disabled:bg-transparent">{units.map((unit) => <option key={unit}>{unit}</option>)}</select></div>{item.locked ? <div className="mt-5 grid h-10 w-10 place-items-center text-emerald-600"><CheckCircle2 size={17} /></div> : <button onClick={() => setDraft({ ...draft, products: draft.products.filter((_, productIndex) => productIndex !== index) })} className="mt-5 grid h-10 w-10 place-items-center rounded-xl text-neutral-400 hover:text-red-500"><Trash2 size={17} /></button>}</div>)}</div> : <p className="mt-3 text-xs text-neutral-400">Sin productos.</p>}</section></div>}{error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between"><button disabled={saving} onClick={() => void clearSlot()} className="rounded-2xl px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">{draft.recipes.some((item) => item.locked) || draft.products.some((item) => item.locked) ? 'Quitar pendientes' : 'Dejar sin planificar'}</button><button disabled={saving} onClick={() => void saveSlot()} className="rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button></div></div></div>}
    {completionTarget?.kind === 'recipe' && <CompleteRecipeModal entryId={completionTarget.entryId} recipeId={completionTarget.recipeId} recipeName={completionTarget.recipeName} servings={completionTarget.servings} onClose={() => setCompletionTarget(null)} onCompleted={() => { setCompletionTarget(null); void loadWeek() }} />}
    {completionTarget?.kind === 'product' && <CompleteProductModal entryId={completionTarget.entryId} productId={completionTarget.productId} productName={completionTarget.productName} quantity={completionTarget.quantity} unit={completionTarget.unit} onClose={() => setCompletionTarget(null)} onCompleted={() => { setCompletionTarget(null); void loadWeek() }} />}
  </div>
}
