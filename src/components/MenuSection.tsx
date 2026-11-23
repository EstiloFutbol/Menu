import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Copy, LockKeyhole, Plus, RotateCcw, Trash2, UtensilsCrossed, X } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, aggregateNeeds, compareNeedWithPantry, convertCompatibleQuantity, formatBaseQuantity, formatQuantity, formatWeekRange, localDateString, pendingPlannedLines, shouldShowPantryItem, startOfWeek, weekdayIndex, weekdayNames, type WeekStart } from '../lib/domain'
import { describeUndo, type UndoResult } from '../lib/consumption'
import { describeWeekCopy, type WeekCopyResult } from '../lib/week-copy'
import { friendlyError } from '../lib/errors'
import { guessCategory } from '../lib/recipe-import'
import { normalizeReceiptName } from '../lib/receipt'
import { useSettings } from '../lib/settings'
import { supabase } from '../lib/supabase'
import CompleteProductModal from './CompleteProductModal'
import CompleteRecipeModal from './CompleteRecipeModal'
import { NumberInput } from './NumberInput'
import { useRefreshOnReturn } from '../lib/refresh'

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
const productCategories = ['Fruta y verdura', 'Carne', 'Pescado y marisco', 'Lácteos y huevos', 'Panadería', 'Despensa', 'Congelados', 'Bebidas', 'Salsas y condimentos', 'Otros']
const NEW_PRODUCT = '__nuevo__'
type Recipe = { id: string; name: string; base_servings: number }
type Ingredient = { id: string; name: string; category: string | null; default_unit: Unit | null }
type PlannedRecipe = { id: string; recipe_id: string; servings: number; sort_order: number; recipe: { id: string; name: string; base_servings: number; recipe_ingredients: { ingredient_id: string; quantity: number; unit: Unit }[] } | null }
type PlannedProduct = { id: string; ingredient_id: string; quantity: number; unit: Unit; sort_order: number; ingredient: Ingredient | null }
type ConsumptionLog = { id: string; recipe_id: string | null; menu_entry_recipe_id: string | null; menu_entry_product_id: string | null; consumed_at: string }
type MenuEntry = { id: string; planned_date: string; meal: MealType; is_eating_out: boolean; completed_at: string | null; menu_entry_recipes: PlannedRecipe[]; menu_entry_products: PlannedProduct[]; consumption_logs: ConsumptionLog[] }
type SlotDraftRecipe = { rowId?: string; recipeId: string; servings: string; locked?: boolean }
type SlotDraftProduct = { rowId?: string; ingredientId: string; quantity: string; unit: Unit; locked?: boolean }
type PantryRow = { ingredient_id: string; quantity: number | null; unit: Unit | null; status: 'tengo' | 'queda_poco' | 'no_tengo' | null }
type SlotDraft = { date: string; meal: MealType; mode: 'normal' | 'eating_out'; recipes: SlotDraftRecipe[]; products: SlotDraftProduct[]; repeatTargets: string[]; showRepeat: boolean }
type AddToSlotsResult = { added: number; skipped: { planned_date: string; meal: MealType }[] }
type RecipeCompletion = { kind: 'recipe'; plannedRecipeId: string; recipeId: string; recipeName: string; servings: number }
type ProductCompletion = { kind: 'product'; entryId: string; productId: string; productName: string; quantity: number; unit: Unit }
type CompletionTarget = RecipeCompletion | ProductCompletion

function parseLocalDate(value: string) { const [year, month, day] = value.split('-').map(Number); return new Date(year, month - 1, day) }
function formatShortDate(value: string) { return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(parseLocalDate(value)) }
function slotKey(date: string, meal: MealType) { return `${date}:${meal}` }
function pantryShortfall(item: SlotDraftProduct, pantryRow: PantryRow | undefined) {
  if (item.locked || !pantryRow || pantryRow.quantity == null || !pantryRow.unit) return null
  const planned = convertCompatibleQuantity(Number(item.quantity), item.unit, pantryRow.unit)
  if (planned == null || !Number.isFinite(planned)) return null
  const have = Number(pantryRow.quantity)
  return planned > have ? { have, missing: planned - have, unit: pantryRow.unit } : null
}

function mealLabel(meal: MealType) { return mealTypes.find((item) => item.id === meal)?.label ?? meal }
function slotsFromKeys(keys: string[]) { return keys.map((key) => { const [planned_date, meal] = key.split(':'); return { planned_date, meal } }) }
function skippedNotice(result: AddToSlotsResult) {
  if (!result.skipped.length) return ''
  return `No se añadió a ${result.skipped.map((slot) => `${mealLabel(slot.meal).toLowerCase()} del ${formatShortDate(slot.planned_date)}`).join(', ')} porque está marcada como “Comida fuera”.`
}

// Rejilla de días × comidas para elegir franjas destino. Permite moverse entre semanas sin perder lo marcado.
function SlotPicker({ initialWeek, weekStartsOn, visibleMeals, excludeKey, selected, onChange }: { initialWeek: Date; weekStartsOn: WeekStart; visibleMeals: readonly MealType[]; excludeKey?: string; selected: string[]; onChange: (next: string[]) => void }) {
  const [pickerWeek, setPickerWeek] = useState(() => startOfWeek(initialWeek, weekStartsOn))
  const dayLabels = weekdayNames(weekStartsOn)
  const days = Array.from({ length: 7 }, (_, index) => localDateString(addDays(pickerWeek, index)))
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key])
  return <div className="rounded-2xl border border-neutral-200 bg-white p-3">
    <div className="flex items-center justify-between gap-2"><button type="button" onClick={() => setPickerWeek(addDays(pickerWeek, -7))} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100" aria-label="Semana anterior"><ChevronLeft size={16} /></button><p className="text-xs font-medium text-neutral-600">{formatWeekRange(pickerWeek)}</p><button type="button" onClick={() => setPickerWeek(addDays(pickerWeek, 7))} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-500 hover:bg-neutral-100" aria-label="Semana siguiente"><ChevronRight size={16} /></button></div>
    <div className="mt-2 grid grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-1 text-center">
      <div />{days.map((date, index) => <div key={date} className="text-[10px] font-medium text-neutral-500">{dayLabels[index].slice(0, 2)}<span className="block text-neutral-400">{parseLocalDate(date).getDate()}</span></div>)}
      {mealTypes.filter((meal) => visibleMeals.includes(meal.id)).map((meal) => <Fragment key={meal.id}><div className="flex items-center text-left text-[11px] font-medium text-neutral-500">{meal.label}</div>{days.map((date) => { const key = slotKey(date, meal.id); if (key === excludeKey) return <div key={key} className="h-8 rounded-lg bg-neutral-100" title="Franja actual" />; const checked = selected.includes(key); return <button type="button" key={key} onClick={() => toggle(key)} aria-pressed={checked} aria-label={`${meal.label} ${formatShortDate(date)}`} className={`grid h-8 place-items-center rounded-lg border text-xs ${checked ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 text-transparent hover:bg-neutral-50'}`}><CheckCircle2 size={14} /></button> })}</Fragment>)}
    </div>
    <p className="mt-2 text-[11px] text-neutral-400">{selected.length ? `${selected.length} comida${selected.length === 1 ? '' : 's'} seleccionada${selected.length === 1 ? '' : 's'}.` : 'Marca las comidas donde quieres añadirlo.'} Lo que ya haya en ellas se mantiene.</p>
  </div>
}

export default function MenuSection() {
  const { settings } = useSettings()
  const { weekStartsOn, defaultServings } = settings
  const dayLabels = useMemo(() => weekdayNames(weekStartsOn), [weekStartsOn])
  const shownMeals = useMemo(() => mealTypes.filter((meal) => settings.visibleMeals.includes(meal.id)), [settings.visibleMeals])
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), weekStartsOn))
  const [mobileDay, setMobileDay] = useState(() => weekdayIndex(new Date(), weekStartsOn))
  // Si cambia el día de inicio (al cargar las preferencias), se recoloca la semana mostrada.
  useEffect(() => { setWeekStart((current) => startOfWeek(addDays(current, 3), weekStartsOn)); setMobileDay(weekdayIndex(new Date(), weekStartsOn)) }, [weekStartsOn])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [entries, setEntries] = useState<MenuEntry[]>([])
  const [pantry, setPantry] = useState<PantryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<SlotDraft | null>(null)
  // Producto nuevo que se está creando desde una fila de la franja.
  const [newProduct, setNewProduct] = useState<{ index: number; name: string; category: string; unit: Unit; saving: boolean; error: string } | null>(null)
  useEffect(() => { setNewProduct(null) }, [draft?.date, draft?.meal, draft?.products.length])
  const [completionTarget, setCompletionTarget] = useState<CompletionTarget | null>(null)
  const [notice, setNotice] = useState('')
  // Copiar la semana que se está viendo a otra semana.
  const [weekCopy, setWeekCopy] = useState<{ target: Date; replace: boolean; targetSlots: number | null } | null>(null)
  const [weekCopyMessage, setWeekCopyMessage] = useState('')
  // Resultado de deshacer un consumo (lo devuelto a la despensa).
  const [undoMessage, setUndoMessage] = useState('')
  const [undoingLogId, setUndoingLogId] = useState<string | null>(null)
  const [showSummary, setShowSummary] = useState(false)

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => { const date = addDays(weekStart, index); return { date: localDateString(date), label: dayLabels[index] } }), [weekStart, dayLabels])
  // Lo que hay planificado en la semana que se está viendo (para copiarla).
  const weekPlan = useMemo(() => {
    const planned = entries.filter((entry) => entry.is_eating_out || entry.menu_entry_recipes?.length || entry.menu_entry_products?.length)
    return {
      slots: planned.length,
      recipes: planned.reduce((total, entry) => total + (entry.is_eating_out ? 0 : entry.menu_entry_recipes?.length ?? 0), 0),
      products: planned.reduce((total, entry) => total + (entry.is_eating_out ? 0 : entry.menu_entry_products?.length ?? 0), 0),
      eatingOut: planned.filter((entry) => entry.is_eating_out).length,
    }
  }, [entries])
  const entriesBySlot = useMemo(() => { const map = new Map<string, MenuEntry>(); entries.forEach((entry) => map.set(slotKey(entry.planned_date, entry.meal), entry)); return map }, [entries])
  const pantryByIngredient = useMemo(() => new Map(pantry.map((row) => [row.ingredient_id, row])), [pantry])
  // Resumen semanal: lo pendiente del menú comparado con la despensa, con el mismo cálculo que la lista de la compra.
  const weekSummary = useMemo(() => {
    const names = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient.name]))
    return aggregateNeeds(pendingPlannedLines(entries))
      .map((need) => ({ need, name: names.get(need.ingredientId) ?? 'Producto', comparison: compareNeedWithPantry(need, pantryByIngredient.get(need.ingredientId)) }))
      .sort((a, b) => Number(b.comparison.missing > 0) - Number(a.comparison.missing > 0) || a.name.localeCompare(b.name, 'es'))
  }, [entries, ingredients, pantryByIngredient])
  const summaryMissing = weekSummary.filter((row) => row.comparison.missing > 0 && !row.comparison.pantryCheckRequired).length
  const summaryToCheck = weekSummary.filter((row) => row.comparison.pantryCheckRequired).length
  const availableIngredients = useMemo(() => ingredients.filter((ingredient) => { const row = pantryByIngredient.get(ingredient.id); return row ? shouldShowPantryItem(row) : false }), [ingredients, pantryByIngredient])

  const loadRecipes = useCallback(async () => { if (!supabase) return; const { data, error: queryError } = await supabase.from('recipes').select('id,name,base_servings').order('name'); if (queryError) throw queryError; setRecipes((data ?? []) as Recipe[]) }, [])
  const loadIngredients = useCallback(async () => { if (!supabase) return; const { data, error: queryError } = await supabase.from('ingredients').select('id,name,category,default_unit').order('name'); if (queryError) throw queryError; setIngredients((data ?? []) as Ingredient[]) }, [])
  const loadPantry = useCallback(async () => { if (!supabase) return; const { data, error: queryError } = await supabase.from('pantry_items').select('ingredient_id,quantity,unit,status'); if (queryError) throw queryError; setPantry((data ?? []) as PantryRow[]) }, [])
  const loadWeek = useCallback(async () => {
    if (!supabase) return
    setLoading(true); setError('')
    try {
      const from = localDateString(weekStart); const to = localDateString(addDays(weekStart, 6))
      const { data, error: queryError } = await supabase.from('menu_entries').select('id,planned_date,meal,is_eating_out,completed_at,menu_entry_recipes(id,recipe_id,servings,sort_order,recipe:recipes(id,name,base_servings,recipe_ingredients(ingredient_id,quantity,unit))),menu_entry_products(id,ingredient_id,quantity,unit,sort_order,ingredient:ingredients(id,name,category,default_unit)),consumption_logs(id,recipe_id,menu_entry_recipe_id,menu_entry_product_id,consumed_at)').gte('planned_date', from).lte('planned_date', to).order('planned_date')
      if (queryError) throw queryError
      setEntries((data ?? []) as unknown as MenuEntry[])
    } catch (cause) { setError(friendlyError(cause, 'No se pudo cargar el menú.')) } finally { setLoading(false) }
  }, [weekStart])

  useEffect(() => { void loadRecipes().catch((cause) => setError(friendlyError(cause, 'No se pudieron cargar las recetas.'))); void loadIngredients().catch((cause) => setError(friendlyError(cause, 'No se pudieron cargar los productos.'))); void loadPantry().catch((cause) => setError(friendlyError(cause, 'No se pudo cargar la despensa.'))) }, [loadRecipes, loadIngredients, loadPantry])
  useEffect(() => { void loadWeek() }, [loadWeek])
  // Al volver a la app se recarga (otra persona del hogar puede haber cambiado el menú).
  useRefreshOnReturn(() => Promise.all([loadWeek(), loadPantry(), loadRecipes(), loadIngredients()]))

  const closeDraft = () => { setDraft(null); setError('') }

  // El aviso de la ventana de una comida se desplaza para que se vea (en el móvil queda abajo).
  const draftErrorRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (draft && error) draftErrorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [draft, error])

  const openSlot = (date: string, meal: MealType) => {
    setError('')
    const current = entriesBySlot.get(slotKey(date, meal))
    const completedRecipeRows = new Set(current?.consumption_logs?.map((log) => log.menu_entry_recipe_id).filter(Boolean) as string[] ?? [])
    const completedProductIds = new Set(current?.consumption_logs?.map((log) => log.menu_entry_product_id).filter(Boolean) as string[] ?? [])
    setDraft({
      date,
      meal,
      mode: current?.is_eating_out ? 'eating_out' : 'normal',
      recipes: current?.menu_entry_recipes?.slice().sort((a, b) => a.sort_order - b.sort_order).map((item) => ({ rowId: item.id, recipeId: item.recipe_id, servings: String(item.servings), locked: completedRecipeRows.has(item.id) })) ?? [],
      products: current?.menu_entry_products?.slice().sort((a, b) => a.sort_order - b.sort_order).map((item) => ({ rowId: item.id, ingredientId: item.ingredient_id, quantity: String(item.quantity), unit: item.unit, locked: completedProductIds.has(item.id) })) ?? [],
      repeatTargets: [],
      showRepeat: false,
    })
    setError(''); setNotice('')
  }

  const saveSlot = async () => {
    if (!supabase || !draft) return
    const current = entriesBySlot.get(slotKey(draft.date, draft.meal))
    const hasConsumption = (current?.consumption_logs?.length ?? 0) > 0
    if (draft.mode === 'eating_out' && hasConsumption) { setError('No puedes convertir en “Comida fuera” una comida que ya tiene algo consumido.'); return }

    // Las filas en las que no se ha elegido receta o producto (p. ej. se pulsó «Añadir» y no se
    // eligió nada) se ignoran. Solo se para el guardado si a algo elegido le falta la cantidad.
    const validRecipes = draft.recipes.filter((item) => item.recipeId && Number(item.servings) > 0)
    const validProducts = draft.products.filter((item) => item.ingredientId && Number(item.quantity) > 0)
    if (draft.mode === 'normal') {
      const recipeWithoutServings = draft.recipes.find((item) => item.recipeId && !(Number(item.servings) > 0))
      if (recipeWithoutServings) { setError(`Indica las raciones de «${recipes.find((recipe) => recipe.id === recipeWithoutServings.recipeId)?.name ?? 'la receta'}».`); return }
      const productWithoutQuantity = draft.products.find((item) => item.ingredientId && !(Number(item.quantity) > 0))
      if (productWithoutQuantity) { setError(`Indica la cantidad de «${ingredients.find((ingredient) => ingredient.id === productWithoutQuantity.ingredientId)?.name ?? 'el producto'}».`); return }
    }

    setSaving(true); setError('')
    try {
      if (!current && draft.mode === 'normal' && validRecipes.length === 0 && validProducts.length === 0) { setDraft(null); return }

      // Lo ya consumido (filas bloqueadas) se conserva en la base de datos; solo se envían las filas pendientes.
      // save_menu_slot lo guarda todo en una transacción: o se guarda la franja entera o no cambia nada.
      const newRecipes = draft.mode === 'normal' ? validRecipes.filter((item) => !item.locked) : []
      const newProducts = draft.mode === 'normal' ? validProducts.filter((item) => !item.locked) : []
      const { error: saveError } = await supabase.rpc('save_menu_slot', {
        p_planned_date: draft.date,
        p_meal: draft.meal,
        p_eating_out: draft.mode === 'eating_out',
        p_recipes: newRecipes.map((item) => ({ recipe_id: item.recipeId, servings: Number(item.servings) })),
        p_products: newProducts.map((item) => ({ ingredient_id: item.ingredientId, quantity: Number(item.quantity), unit: item.unit })),
      })
      if (saveError) throw saveError

      // Lo añadido en esta edición se copia también a las franjas marcadas. La franja actual ya está guardada,
      // así que si la copia falla se avisa fuera del modal sin perder lo guardado.
      // Se repite todo lo que hay en la comida (también lo consumido, como pendiente).
      const repeatRecipes = validRecipes.map((item) => ({ recipe_id: item.recipeId, servings: Number(item.servings) }))
      const repeatProducts = validProducts.map((item) => ({ ingredient_id: item.ingredientId, quantity: Number(item.quantity), unit: item.unit }))
      const repeatTargets = draft.repeatTargets
      setDraft(null)
      if (repeatTargets.length && (repeatRecipes.length || repeatProducts.length)) {
        const { data, error: repeatError } = await supabase.rpc('add_to_menu_slots', { p_slots: slotsFromKeys(repeatTargets), p_recipes: repeatRecipes, p_products: repeatProducts })
        if (repeatError) setError(`La comida se guardó, pero no se pudo añadir a las otras comidas: ${friendlyError(repeatError, 'inténtalo de nuevo.')}`)
        else setNotice(skippedNotice(data as AddToSlotsResult))
      }
      await loadWeek()
    } catch (cause) { setError(friendlyError(cause, 'No se pudo guardar el menú.')) } finally { setSaving(false) }
  }

  // Cuántas franjas con algo planificado tiene la semana de destino.
  const weekCopyTargetKey = weekCopy ? localDateString(weekCopy.target) : ''
  useEffect(() => {
    if (!supabase || !weekCopyTargetKey) return
    let cancelled = false
    const target = parseLocalDate(weekCopyTargetKey)
    void supabase.from('menu_entries').select('id,is_eating_out,menu_entry_recipes(id),menu_entry_products(id)')
      .gte('planned_date', weekCopyTargetKey).lte('planned_date', localDateString(addDays(target, 6)))
      .then(({ data }) => {
        if (cancelled) return
        const rows = (data ?? []) as Array<{ is_eating_out: boolean; menu_entry_recipes: unknown[] | null; menu_entry_products: unknown[] | null }>
        const count = rows.filter((row) => row.is_eating_out || row.menu_entry_recipes?.length || row.menu_entry_products?.length).length
        setWeekCopy((current) => current && localDateString(current.target) === weekCopyTargetKey ? { ...current, targetSlots: count } : current)
      })
    return () => { cancelled = true }
  }, [weekCopyTargetKey])

  const copyWeek = async () => {
    if (!supabase || !weekCopy) return
    setSaving(true); setError(''); setWeekCopyMessage('')
    try {
      const { data, error: copyError } = await supabase.rpc('copy_menu_week', { p_from_week: localDateString(weekStart), p_to_week: localDateString(weekCopy.target), p_replace: weekCopy.replace && (weekCopy.targetSlots ?? 0) > 0 })
      if (copyError) {
        if (/copy_menu_week/.test(copyError.message ?? '') && /function|schema cache/i.test(copyError.message ?? '')) throw new Error('Falta aplicar en Supabase la migración 20261125000100_copy_menu_week.sql.')
        throw copyError
      }
      setWeekCopyMessage(describeWeekCopy(data as WeekCopyResult, `la semana del ${formatWeekRange(weekCopy.target)}`, (date, meal) => `${mealLabel(meal as MealType).toLowerCase()} del ${formatShortDate(date)}`))
      // Se pasa a la semana copiada para verla.
      setWeekStart(weekCopy.target)
      setWeekCopy(null)
    } catch (cause) { setError(friendlyError(cause, 'No se pudo copiar la semana.')) } finally { setSaving(false) }
  }

  // Quita lo pendiente de la franja. Si no hay nada consumido, la franja desaparece.
  const clearSlot = async () => {
    if (!supabase || !draft) return
    const current = entriesBySlot.get(slotKey(draft.date, draft.meal))
    if (!current) { setDraft(null); return }
    setSaving(true); setError('')
    try {
      const { error: saveError } = await supabase.rpc('save_menu_slot', { p_planned_date: draft.date, p_meal: draft.meal, p_eating_out: false, p_recipes: [], p_products: [] })
      if (saveError) throw saveError
      setDraft(null); await loadWeek()
    } catch (cause) { setError(friendlyError(cause, 'No se pudo actualizar la comida.')) } finally { setSaving(false) }
  }

  // Los productos ya guardados siguen apareciendo en su fila aunque se hayan agotado, para no romper la edición.
  // Primero lo que hay en la despensa; después el resto del catálogo (irá a la lista de la compra).
  const otherIngredients = useMemo(() => ingredients.filter((ingredient) => !availableIngredients.some((available) => available.id === ingredient.id)), [ingredients, availableIngredients])

  const createProductForRow = async () => {
    if (!supabase || !draft || !newProduct) return
    const name = newProduct.name.trim()
    if (!name) { setNewProduct({ ...newProduct, error: 'Escribe el nombre del producto.' }); return }
    const choose = (ingredient: Ingredient) => {
      const next = [...draft.products]
      next[newProduct.index] = { ...next[newProduct.index], ingredientId: ingredient.id, unit: ingredient.default_unit ?? newProduct.unit }
      setDraft({ ...draft, products: next })
      setNewProduct(null)
    }
    // Si ya existe (sin tener en cuenta mayúsculas ni tildes), se usa ese.
    const existing = ingredients.find((ingredient) => normalizeReceiptName(ingredient.name) === normalizeReceiptName(name))
    if (existing) { choose(existing); return }
    setNewProduct({ ...newProduct, saving: true, error: '' })
    const { data: authData } = await supabase.auth.getUser()
    if (!authData.user) { setNewProduct({ ...newProduct, saving: false, error: 'Tu sesión ha caducado. Vuelve a iniciar sesión.' }); return }
    const { data, error: insertError } = await supabase.from('ingredients').insert({ user_id: authData.user.id, name, category: newProduct.category, default_unit: newProduct.unit }).select('id,name,category,default_unit').single()
    if (insertError || !data) { setNewProduct({ ...newProduct, saving: false, error: friendlyError(insertError, 'No se pudo crear el producto.', { duplicate: 'Ya existe un producto con ese nombre.' }) }); return }
    const created = data as Ingredient
    setIngredients((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name, 'es')))
    choose(created)
  }

  const productOptionsFor = (ingredientId: string) => {
    const keep = ingredientId && !availableIngredients.some((ingredient) => ingredient.id === ingredientId) && !otherIngredients.some((ingredient) => ingredient.id === ingredientId)
    return [...(keep ? ingredients.filter((ingredient) => ingredient.id === ingredientId) : []), ...availableIngredients]
  }
  const renderShortfall = (item: SlotDraftProduct) => {
    const shortfall = pantryShortfall(item, pantryByIngredient.get(item.ingredientId))
    if (!shortfall) return null
    return <p className="order-5 col-span-full flex items-center gap-1.5 text-xs text-amber-700 sm:order-none"><AlertTriangle size={13} className="shrink-0" /> Tienes {formatQuantity(shortfall.have)} {shortfall.unit}; faltarían {formatQuantity(shortfall.missing)} {shortfall.unit}, que irán a la lista de la compra.</p>
  }

  // «Añadir en varias comidas o días» está siempre disponible si la comida tiene algo y repite todo lo que hay.
  const draftHasRows = Boolean(draft && (draft.recipes.some((item) => item.recipeId) || draft.products.some((item) => item.ingredientId)))

  const selectedMealLabel = draft ? mealTypes.find((item) => item.id === draft.meal)?.label : ''

  // Deshace un consumo: la receta o el producto vuelve a quedar pendiente y se
  // devuelve a la despensa lo que se descontó (nada, si no se descontó nada).
  const undoConsumption = async (logId: string, name: string) => {
    if (!supabase || !window.confirm(`¿Deshacer el consumo de «${name}»? Volverá a quedar pendiente en el menú y se devolverá a la despensa lo que se descontó.`)) return
    setUndoingLogId(logId)
    setError('')
    setUndoMessage('')
    const { data, error: undoError } = await supabase.rpc('undo_consumption', { p_consumption_log_id: logId })
    setUndoingLogId(null)
    if (undoError) {
      setError(/undo_consumption/.test(undoError.message ?? '') && /function|schema cache/i.test(undoError.message ?? '')
        ? 'Falta aplicar en Supabase la migración 20261123000100_undo_consumption.sql.'
        : friendlyError(undoError, 'No se pudo deshacer el consumo.'))
      return
    }
    setUndoMessage(describeUndo(name, data as UndoResult))
    setDraft(null)
    await Promise.all([loadWeek(), loadPantry()]).catch((cause) => setError(friendlyError(cause, 'No se pudo recargar el menú.')))
  }

  const consumptionLogFor = (entry: MenuEntry | undefined, rowId: string | undefined, kind: 'recipe' | 'product') =>
    rowId ? entry?.consumption_logs?.find((log) => (kind === 'recipe' ? log.menu_entry_recipe_id : log.menu_entry_product_id) === rowId) : undefined

  const undoButton = (logId: string | undefined, name: string, className: string, label: React.ReactNode = 'Deshacer') => logId
    ? <button type="button" disabled={undoingLogId === logId} onClick={(event) => { event.stopPropagation(); void undoConsumption(logId, name) }} className={className} title="Deshacer el consumo" aria-label={`Deshacer el consumo de ${name}`}>{label}</button>
    : null

  const renderSlotContents = (day: { date: string; label: string }, meal: (typeof mealTypes)[number], compact = false) => {
    const entry = entriesBySlot.get(slotKey(day.date, meal.id))
    const planned = entry?.menu_entry_recipes?.slice().sort((a, b) => a.sort_order - b.sort_order) ?? []
    const products = entry?.menu_entry_products?.slice().sort((a, b) => a.sort_order - b.sort_order) ?? []
    if (entry?.is_eating_out) return <p className="flex items-center gap-1 text-xs font-medium text-neutral-500"><UtensilsCrossed size={12} /> Fuera</p>
    if (!planned.length && !products.length) return <p className="text-xs text-neutral-300">Añadir</p>
    return <div className="space-y-1.5">
      {planned.map((item) => {
        const completed = entry?.consumption_logs?.some((log) => log.menu_entry_recipe_id === item.id) ?? false
        const completeRecipe = (event: React.MouseEvent) => {
          event.stopPropagation()
          setCompletionTarget({ kind: 'recipe', plannedRecipeId: item.id, recipeId: item.recipe_id, recipeName: item.recipe?.name ?? 'Receta', servings: Number(item.servings) })
        }
        return <div key={item.id} onClick={compact && !completed ? completeRecipe : undefined} className={`rounded-lg ${compact ? `-mx-1 px-1 py-0.5 ${completed ? '' : 'cursor-pointer transition hover:bg-neutral-100'}` : 'bg-neutral-50 px-2 py-1.5'}`}><div className="flex items-center gap-1"><p className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-700">{item.recipe?.name ?? 'Receta'}</p>{completed && <CheckCircle2 size={12} className="shrink-0 text-emerald-600" />}</div>{!compact && <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[11px] text-neutral-400">{Number(item.servings).toLocaleString('es-ES')} r.</span>{!completed && <button onClick={completeRecipe} className="text-[11px] font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-2">Completar</button>}{completed && undoButton(consumptionLogFor(entry, item.id, 'recipe')?.id, item.recipe?.name ?? 'Receta', 'text-[11px] font-medium text-neutral-500 underline decoration-neutral-300 underline-offset-2 disabled:opacity-40')}</div>}</div>
      })}
      {products.map((item) => {
        const completed = entry?.consumption_logs?.some((log) => log.menu_entry_product_id === item.id) ?? false
        const completeProduct = (event: React.MouseEvent) => {
          event.stopPropagation()
          setCompletionTarget({ kind: 'product', entryId: entry!.id, productId: item.id, productName: item.ingredient?.name ?? 'Producto', quantity: Number(item.quantity), unit: item.unit })
        }
        return <div key={item.id} onClick={compact && !completed ? completeProduct : undefined} className={`rounded-lg ${compact ? `-mx-1 px-1 py-0.5 ${completed ? '' : 'cursor-pointer transition hover:bg-neutral-100'}` : 'bg-neutral-50 px-2 py-1.5'}`}><div className="flex items-center gap-1"><p className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-700">{item.ingredient?.name ?? 'Producto'}</p>{completed && <CheckCircle2 size={12} className="shrink-0 text-emerald-600" />}</div>{!compact && <div className="mt-1 flex items-center justify-between gap-2"><span className="text-[11px] text-neutral-400">{formatQuantity(Number(item.quantity))} {item.unit}</span>{!completed && <button onClick={completeProduct} className="text-[11px] font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-2">Completar</button>}{completed && undoButton(consumptionLogFor(entry, item.id, 'product')?.id, item.ingredient?.name ?? 'Producto', 'text-[11px] font-medium text-neutral-500 underline decoration-neutral-300 underline-offset-2 disabled:opacity-40')}</div>}</div>
      })}
    </div>
  }

  return <div className="space-y-5">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-neutral-500">Planificación semanal</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">Tu menú</h1><p className="mt-2 text-sm text-neutral-500">{formatWeekRange(weekStart)}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setWeekStart(addDays(weekStart, -7))} className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm" aria-label="Semana anterior"><ChevronLeft size={18} /></button><button onClick={() => { setWeekStart(startOfWeek(new Date(), weekStartsOn)); setMobileDay(weekdayIndex(new Date(), weekStartsOn)) }} className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm">Esta semana</button><button onClick={() => setWeekStart(addDays(weekStart, 7))} className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm" aria-label="Semana siguiente"><ChevronRight size={18} /></button><button onClick={() => { setError(''); setWeekCopy({ target: addDays(weekStart, 7), replace: false, targetSlots: null }) }} disabled={!weekPlan.slots} title={weekPlan.slots ? 'Copiar esta semana a otra' : 'No hay nada planificado esta semana'} aria-label="Copiar semana" className="flex items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm disabled:opacity-40"><Copy size={16} /> <span className="sm:hidden">Copiar</span><span className="hidden sm:inline">Copiar semana</span></button></div></header>
    {undoMessage && <div className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>{undoMessage}</span><button onClick={() => setUndoMessage('')} className="shrink-0 text-emerald-700" aria-label="Cerrar aviso"><X size={16} /></button></div>}
    {notice && <div className="flex items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><span>{notice}</span><button onClick={() => setNotice('')} className="shrink-0 text-amber-700" aria-label="Cerrar aviso"><X size={16} /></button></div>}
    {!loading && weekSummary.length > 0 && <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <button onClick={() => setShowSummary(!showSummary)} aria-expanded={showSummary} className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5"><ClipboardList size={18} className="shrink-0 text-neutral-500" /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-neutral-900">Resumen de la semana</span><span className="block text-xs text-neutral-500">{summaryMissing || summaryToCheck ? [summaryMissing ? `${summaryMissing} por comprar` : '', summaryToCheck ? `${summaryToCheck} por revisar en despensa` : ''].filter(Boolean).join(' · ') : 'Tienes todo lo pendiente en despensa'}</span></span><ChevronDown size={16} className={`shrink-0 text-neutral-400 transition ${showSummary ? 'rotate-180' : ''}`} /></button>
      {showSummary && <div className="border-t border-neutral-100">
        <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,80px))] gap-2 bg-neutral-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400 sm:px-5"><span>Producto</span><span className="text-right">Necesitas</span><span className="text-right">Tienes</span><span className="text-right">Falta</span></div>
        <div className="divide-y divide-neutral-100">{weekSummary.map(({ need, name, comparison }) => <div key={`${need.ingredientId}:${need.baseUnit}`} className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,80px))] items-center gap-2 px-4 py-2 text-sm sm:px-5"><span className="truncate text-neutral-800">{name}</span><span className="text-right text-neutral-600">{formatBaseQuantity(need.needed, need.baseUnit)}</span><span className="text-right text-neutral-600">{comparison.have == null ? '¿?' : formatBaseQuantity(comparison.have, need.baseUnit)}</span><span className={`text-right font-medium ${comparison.pantryCheckRequired ? 'text-amber-700' : comparison.missing > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{comparison.pantryCheckRequired ? 'Revisar' : comparison.missing > 0 ? formatBaseQuantity(comparison.missing, need.baseUnit) : 'OK'}</span></div>)}</div>
        <p className="border-t border-neutral-100 px-4 py-2 text-[11px] text-neutral-400 sm:px-5">Solo cuenta lo que aún no has consumido. “Revisar” significa que la despensa no tiene una cantidad comparable.</p>
      </div>}
    </section>}
    {weekCopyMessage && <div className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>{weekCopyMessage}</span><button onClick={() => setWeekCopyMessage('')} className="shrink-0 text-emerald-700" aria-label="Cerrar aviso"><X size={16} /></button></div>}
    {weekCopy && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && !saving && setWeekCopy(null)}><div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-neutral-500">Copiar semana</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">{formatWeekRange(weekStart)}</h2></div><button disabled={saving} onClick={() => setWeekCopy(null)} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-100" aria-label="Cerrar"><X size={19} /></button></div>
      <div className="mt-4 rounded-2xl bg-neutral-50 p-3 text-sm text-neutral-600">Se copiará{weekPlan.slots === 1 ? '' : 'n'} {weekPlan.slots} comida{weekPlan.slots === 1 ? '' : 's'}: {[weekPlan.recipes ? `${weekPlan.recipes} receta${weekPlan.recipes === 1 ? '' : 's'}` : '', weekPlan.products ? `${weekPlan.products} producto${weekPlan.products === 1 ? '' : 's'}` : '', weekPlan.eatingOut ? `${weekPlan.eatingOut} comida${weekPlan.eatingOut === 1 ? '' : 's'} fuera` : ''].filter(Boolean).join(', ')}. Cada una va al mismo día y comida de la otra semana, y todo queda pendiente aunque aquí ya esté consumido.</div>
      <p className="mt-5 text-sm font-semibold text-neutral-900">A la semana</p>
      <div className="mt-2 flex items-center justify-between gap-2 rounded-2xl border border-neutral-200 p-1.5"><button type="button" onClick={() => { const previous = addDays(weekCopy.target, -7); setWeekCopy({ ...weekCopy, target: localDateString(previous) === localDateString(weekStart) ? addDays(previous, -7) : previous, targetSlots: null }) }} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-500 hover:bg-neutral-100" aria-label="Semana anterior"><ChevronLeft size={18} /></button><p className="text-sm font-medium text-neutral-800">{formatWeekRange(weekCopy.target)}{localDateString(weekCopy.target) === localDateString(addDays(weekStart, 7)) && <span className="font-normal text-neutral-400"> · la siguiente</span>}</p><button type="button" onClick={() => { const next = addDays(weekCopy.target, 7); setWeekCopy({ ...weekCopy, target: localDateString(next) === localDateString(weekStart) ? addDays(next, 7) : next, targetSlots: null }) }} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-500 hover:bg-neutral-100" aria-label="Semana siguiente"><ChevronRight size={18} /></button></div>
      <p className="mt-2 text-xs text-neutral-500">{weekCopy.targetSlots == null ? 'Comprobando esa semana…' : weekCopy.targetSlots ? `Esa semana ya tiene ${weekCopy.targetSlots} comida${weekCopy.targetSlots === 1 ? '' : 's'} planificada${weekCopy.targetSlots === 1 ? '' : 's'}.` : 'Esa semana está vacía.'}</p>
      {(weekCopy.targetSlots ?? 0) > 0 && <div className="mt-3 space-y-2">
        <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm ${!weekCopy.replace ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200'}`}><input type="radio" name="week-copy-mode" checked={!weekCopy.replace} onChange={() => setWeekCopy({ ...weekCopy, replace: false })} className="mt-0.5" /><span><span className="block font-medium text-neutral-900">Añadir a lo que ya hay</span><span className="text-xs text-neutral-500">Se mantiene lo planificado en esa semana y se añade lo copiado.</span></span></label>
        <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm ${weekCopy.replace ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200'}`}><input type="radio" name="week-copy-mode" checked={weekCopy.replace} onChange={() => setWeekCopy({ ...weekCopy, replace: true })} className="mt-0.5" /><span><span className="block font-medium text-neutral-900">Sustituir lo pendiente</span><span className="text-xs text-neutral-500">Se quita lo pendiente de esa semana antes de copiar. Lo ya consumido se conserva.</span></span></label>
      </div>}
      {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="mt-6 flex justify-end gap-2"><button disabled={saving} onClick={() => setWeekCopy(null)} className="rounded-2xl px-4 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50">Cancelar</button><button disabled={saving || weekCopy.targetSlots == null} onClick={() => void copyWeek()} className="rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Copiando…' : 'Copiar semana'}</button></div>
    </div></div>}
    {error && !draft && !completionTarget && !weekCopy && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {loading ? <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-sm text-neutral-500 shadow-sm">Cargando menú…</div> : <>
      <div className="lg:hidden">
        <div className="grid grid-cols-7 gap-1 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-sm">{weekDays.map((day, index) => { const today = day.date === localDateString(new Date()); return <button key={day.date} onClick={() => setMobileDay(index)} className={`rounded-xl px-1 py-2 text-center ${mobileDay === index ? 'bg-neutral-900 text-white' : 'text-neutral-500'}`}><span className="block text-[10px] font-medium">{day.label.slice(0, 2)}</span><span className="mt-0.5 block text-xs font-semibold">{parseLocalDate(day.date).getDate()}</span>{today && <span className={`mx-auto mt-1 block h-1 w-1 rounded-full ${mobileDay === index ? 'bg-white' : 'bg-neutral-900'}`} />}</button> })}</div>
        <section className="mt-3 overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm"><div className="border-b border-neutral-100 px-4 py-3"><h2 className="font-semibold">{weekDays[mobileDay].label}</h2><p className="text-xs text-neutral-400">{formatShortDate(weekDays[mobileDay].date)}</p></div><div className="divide-y divide-neutral-100">{shownMeals.map((meal) => <button key={meal.id} onClick={() => openSlot(weekDays[mobileDay].date, meal.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left"><span className="w-20 shrink-0 pt-0.5 text-xs font-semibold text-neutral-500">{meal.label}</span><div className="min-w-0 flex-1">{renderSlotContents(weekDays[mobileDay], meal)}</div></button>)}</div></section>
      </div>
      <div className="hidden overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm lg:block"><div className="grid grid-cols-[110px_repeat(7,minmax(0,1fr))] border-b border-neutral-200 bg-neutral-50"><div className="p-3" />{weekDays.map((day) => { const today = day.date === localDateString(new Date()); return <div key={day.date} className={`border-l border-neutral-200 p-3 text-center ${today ? 'bg-white' : ''}`}><p className="text-xs font-semibold text-neutral-700">{day.label}</p><p className="mt-0.5 text-[11px] text-neutral-400">{formatShortDate(day.date)}{today ? ' · Hoy' : ''}</p></div> })}</div>{shownMeals.map((meal) => <div key={meal.id} className="grid grid-cols-[110px_repeat(7,minmax(0,1fr))] border-b border-neutral-100 last:border-0"><div className="flex items-center px-3 py-3 text-xs font-semibold text-neutral-500">{meal.label}</div>{weekDays.map((day) => { const entry = entriesBySlot.get(slotKey(day.date, meal.id)); return <button key={day.date} onClick={() => openSlot(day.date, meal.id)} className="min-h-24 border-l border-neutral-100 p-2.5 text-left transition hover:bg-neutral-50"><div className="flex items-start justify-between gap-1">{renderSlotContents(day, meal, true)}{entry?.completed_at && <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />}</div></button> })}</div>)}</div>
    </>}

    {draft && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && !saving && closeDraft()}><div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium text-neutral-500">{formatShortDate(draft.date)}</p><h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">{selectedMealLabel}</h2></div><button disabled={saving} onClick={closeDraft} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-100" aria-label="Cerrar"><X size={19} /></button></div><div className="mt-6 grid grid-cols-2 rounded-2xl bg-neutral-100 p-1"><button onClick={() => setDraft({ ...draft, mode: 'normal' })} className={`rounded-xl px-3 py-2 text-sm font-medium ${draft.mode === 'normal' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>Comida</button><button disabled={draft.recipes.some((item) => item.locked) || draft.products.some((item) => item.locked)} onClick={() => setDraft({ ...draft, mode: 'eating_out', recipes: [], products: [] })} className={`rounded-xl px-3 py-2 text-sm font-medium disabled:opacity-40 ${draft.mode === 'eating_out' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>Comida fuera</button></div>{draft.mode === 'eating_out' ? <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-600">Esta comida no añadirá ingredientes a la lista de la compra ni descontará productos de la despensa.</div> : <div className="mt-5 space-y-6"><section><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-neutral-900">Recetas</h3><p className="mt-0.5 text-xs text-neutral-400">Lo ya consumido queda protegido (con ↺ puedes deshacerlo). Puedes añadir más, incluso repetir una receta.</p></div><button onClick={() => setDraft({ ...draft, recipes: [...draft.recipes, { recipeId: '', servings: String(defaultServings) }] })} className="flex items-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700"><Plus size={14} /> Añadir</button></div>{draft.recipes.length ? <div className="mt-3 space-y-2">{draft.recipes.map((item, index) => <div key={item.rowId ?? `new-recipe-${index}`} className={`grid grid-cols-[minmax(0,1fr)_90px_40px] gap-2 rounded-2xl border p-3 ${item.locked ? 'border-emerald-100 bg-emerald-50/50' : 'border-neutral-200 bg-neutral-50'}`}><div><label className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-500">Receta {item.locked && <LockKeyhole size={11} />}</label><select disabled={item.locked} value={item.recipeId} onChange={(event) => { const next = [...draft.recipes]; next[index] = { ...next[index], recipeId: event.target.value }; setDraft({ ...draft, recipes: next }) }} className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm disabled:bg-transparent">{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}<option value="">Seleccionar…</option></select></div><div><label className="mb-1 block text-xs font-medium text-neutral-500">Raciones</label><NumberInput kind="servings" disabled={item.locked} value={item.servings} onValueChange={(input) => { const next = [...draft.recipes]; next[index] = { ...next[index], servings: input }; setDraft({ ...draft, recipes: next }) }} className={`w-full rounded-xl border px-3 py-2.5 text-sm disabled:bg-transparent ${item.recipeId && !item.locked && !(Number(item.servings) > 0) ? 'border-red-300 bg-red-50' : 'border-neutral-200 bg-white'}`} /></div>{item.locked ? (undoButton(consumptionLogFor(entriesBySlot.get(slotKey(draft.date, draft.meal)), item.rowId, 'recipe')?.id, recipes.find((recipe) => recipe.id === item.recipeId)?.name ?? 'Receta', 'mt-5 grid h-10 w-10 place-items-center rounded-xl text-emerald-600 hover:bg-white hover:text-neutral-700 disabled:opacity-40', <RotateCcw size={17} />) ?? <div className="mt-5 grid h-10 w-10 place-items-center text-emerald-600"><CheckCircle2 size={17} /></div>) : <button onClick={() => setDraft({ ...draft, recipes: draft.recipes.filter((_, recipeIndex) => recipeIndex !== index) })} className="mt-5 grid h-10 w-10 place-items-center rounded-xl text-neutral-400 hover:text-red-500"><Trash2 size={17} /></button>}</div>)}</div> : <p className="mt-3 text-xs text-neutral-400">Sin recetas.</p>}</section><section><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-neutral-900">Productos</h3><p className="mt-0.5 text-xs text-neutral-400">Elige de tu despensa o del catálogo, o crea uno nuevo. Puedes repetir uno ya consumido.</p></div><button onClick={() => setDraft({ ...draft, products: [...draft.products, { ingredientId: '', quantity: '1', unit: 'unidad' }] })} className="flex items-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700"><Plus size={14} /> Añadir</button></div>{draft.products.length ? <div className="mt-3 space-y-2">{draft.products.map((item, index) => <div key={item.rowId ?? `new-product-${index}`} className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px] gap-2 rounded-2xl border p-3 sm:grid-cols-[minmax(0,1fr)_80px_105px_40px] ${item.locked ? 'border-emerald-100 bg-emerald-50/50' : 'border-neutral-200 bg-neutral-50'}`}><div className="order-1 col-span-2 sm:order-none sm:col-span-1"><label className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-500">Producto {item.locked && <LockKeyhole size={11} />}</label><select disabled={item.locked} value={item.ingredientId} onChange={(event) => { if (event.target.value === NEW_PRODUCT) { setNewProduct({ index, name: '', category: 'Otros', unit: 'unidad', saving: false, error: '' }); return } const ingredient = ingredients.find((candidate) => candidate.id === event.target.value); const pantryRow = pantryByIngredient.get(event.target.value); const next = [...draft.products]; next[index] = { ...next[index], ingredientId: event.target.value, unit: pantryRow?.unit ?? ingredient?.default_unit ?? next[index].unit }; setDraft({ ...draft, products: next }) }} className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm disabled:bg-transparent"><option value="">Seleccionar…</option><optgroup label="En tu despensa">{productOptionsFor(item.ingredientId).map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}</optgroup>{otherIngredients.length > 0 && <optgroup label="Resto del catálogo (irá a la lista de la compra)">{otherIngredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}</optgroup>}{!item.locked && <option value={NEW_PRODUCT}>+ Crear producto nuevo…</option>}</select></div><div className="order-3 sm:order-none"><label className="mb-1 block text-xs font-medium text-neutral-500">Cantidad</label><NumberInput kind="quantity" disabled={item.locked} value={item.quantity} onValueChange={(input) => { const next = [...draft.products]; next[index] = { ...next[index], quantity: input }; setDraft({ ...draft, products: next }) }} className={`w-full rounded-xl border px-2 py-2.5 text-sm disabled:bg-transparent ${item.ingredientId && !item.locked && !(Number(item.quantity) > 0) ? 'border-red-300 bg-red-50' : 'border-neutral-200 bg-white'}`} /></div><div className="order-4 col-span-2 sm:order-none sm:col-span-1"><label className="mb-1 block text-xs font-medium text-neutral-500">Unidad</label><select disabled={item.locked} value={item.unit} onChange={(event) => { const next = [...draft.products]; next[index] = { ...next[index], unit: event.target.value as Unit }; setDraft({ ...draft, products: next }) }} className="w-full rounded-xl border border-neutral-200 bg-white px-2 py-2.5 text-sm disabled:bg-transparent">{units.map((unit) => <option key={unit}>{unit}</option>)}</select></div>{item.locked ? (undoButton(consumptionLogFor(entriesBySlot.get(slotKey(draft.date, draft.meal)), item.rowId, 'product')?.id, ingredients.find((ingredient) => ingredient.id === item.ingredientId)?.name ?? 'Producto', 'order-2 mt-5 grid h-10 w-10 place-items-center rounded-xl text-emerald-600 hover:bg-white hover:text-neutral-700 disabled:opacity-40 sm:order-none', <RotateCcw size={17} />) ?? <div className="order-2 mt-5 grid h-10 w-10 place-items-center text-emerald-600 sm:order-none"><CheckCircle2 size={17} /></div>) : <button onClick={() => setDraft({ ...draft, products: draft.products.filter((_, productIndex) => productIndex !== index) })} className="order-2 mt-5 grid h-10 w-10 place-items-center rounded-xl text-neutral-400 hover:text-red-500 sm:order-none"><Trash2 size={17} /></button>}{renderShortfall(item)}{newProduct?.index === index && <div className="order-6 col-span-full mt-1 rounded-xl sm:order-none border border-neutral-200 bg-white p-3"><p className="text-xs font-semibold text-neutral-700">Nuevo producto</p><div className="mt-2 grid grid-cols-2 gap-2"><input autoFocus value={newProduct.name} onChange={(event) => setNewProduct({ ...newProduct, name: event.target.value, category: newProduct.category === 'Otros' || newProduct.category === guessCategory(newProduct.name) ? guessCategory(event.target.value) : newProduct.category, error: '' })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void createProductForRow() } }} placeholder="Nombre, p. ej. Yogur natural" className="col-span-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm" /><select aria-label="Categoría" value={newProduct.category} onChange={(event) => setNewProduct({ ...newProduct, category: event.target.value })} className="rounded-lg border border-neutral-200 bg-white px-2 py-2 text-sm">{productCategories.map((category) => <option key={category}>{category}</option>)}</select><select aria-label="Unidad habitual" value={newProduct.unit} onChange={(event) => setNewProduct({ ...newProduct, unit: event.target.value as Unit })} className="rounded-lg border border-neutral-200 bg-white px-2 py-2 text-sm">{units.map((unit) => <option key={unit}>{unit}</option>)}</select></div>{newProduct.error && <p className="mt-2 text-xs text-red-600">{newProduct.error}</p>}<div className="mt-2 flex justify-end gap-2"><button type="button" disabled={newProduct.saving} onClick={() => setNewProduct(null)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100">Cancelar</button><button type="button" disabled={newProduct.saving || !newProduct.name.trim()} onClick={() => void createProductForRow()} className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">{newProduct.saving ? 'Creando…' : 'Crear y usar'}</button></div></div>}</div>)}</div> : <p className="mt-3 text-xs text-neutral-400">Sin productos.</p>}</section>{draftHasRows && <section><button type="button" onClick={() => setDraft({ ...draft, showRepeat: !draft.showRepeat })} className="flex w-full items-center justify-between rounded-2xl border border-neutral-200 px-4 py-3 text-left"><span><span className="block text-sm font-semibold text-neutral-900">Añadir en varias comidas o días</span><span className="mt-0.5 block text-xs text-neutral-400">{draft.repeatTargets.length ? `Se añadirá todo lo de esta comida a ${draft.repeatTargets.length} comida${draft.repeatTargets.length === 1 ? '' : 's'} más.` : 'Marca otras comidas o días y todo lo de esta comida se repetirá en ellos, como pendiente.'}</span></span><ChevronRight size={16} className={`shrink-0 text-neutral-400 transition ${draft.showRepeat ? 'rotate-90' : ''}`} /></button>{draft.showRepeat && <div className="mt-2"><SlotPicker weekStartsOn={weekStartsOn} visibleMeals={settings.visibleMeals} initialWeek={parseLocalDate(draft.date)} excludeKey={slotKey(draft.date, draft.meal)} selected={draft.repeatTargets} onChange={(next) => setDraft({ ...draft, repeatTargets: next })} /></div>}</section>}</div>}{error && <div ref={draftErrorRef} className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between"><button disabled={saving} onClick={() => void clearSlot()} className="rounded-2xl px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">{draft.recipes.some((item) => item.locked) || draft.products.some((item) => item.locked) ? 'Quitar pendientes' : 'Dejar sin planificar'}</button><button disabled={saving} onClick={() => void saveSlot()} className="rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button></div></div></div>}
    {completionTarget?.kind === 'recipe' && <CompleteRecipeModal plannedRecipeId={completionTarget.plannedRecipeId} recipeId={completionTarget.recipeId} recipeName={completionTarget.recipeName} servings={completionTarget.servings} onClose={() => setCompletionTarget(null)} onCompleted={() => { setCompletionTarget(null); void loadWeek(); void loadPantry() }} />}
    {completionTarget?.kind === 'product' && <CompleteProductModal entryId={completionTarget.entryId} productId={completionTarget.productId} productName={completionTarget.productName} quantity={completionTarget.quantity} unit={completionTarget.unit} onClose={() => setCompletionTarget(null)} onCompleted={() => { setCompletionTarget(null); void loadWeek(); void loadPantry() }} />}
  </div>
}
