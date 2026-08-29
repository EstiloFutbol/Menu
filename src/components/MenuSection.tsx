import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, UtensilsCrossed, X } from 'lucide-react'
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

type Recipe = {
  id: string
  name: string
  base_servings: number
}

type PlannedRecipe = {
  id: string
  recipe_id: string
  servings: number
  sort_order: number
  recipe: { id: string; name: string } | null
}

type MenuEntry = {
  id: string
  planned_date: string
  meal: MealType
  is_eating_out: boolean
  completed_at: string | null
  menu_entry_recipes: PlannedRecipe[]
}

type SlotDraftRecipe = {
  recipeId: string
  servings: string
}

type SlotDraft = {
  date: string
  meal: MealType
  mode: 'recipes' | 'eating_out'
  recipes: SlotDraftRecipe[]
}

const dayLabels = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

function localDateString(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const weekday = result.getDay()
  const distance = weekday === 0 ? -6 : 1 - weekday
  result.setDate(result.getDate() + distance)
  return result
}

function addDays(date: Date, days: number) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() + days)
  return result
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(parseLocalDate(value))
}

function formatWeekRange(start: Date) {
  const end = addDays(start, 6)
  const formatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' })
  return `${formatter.format(start)} – ${formatter.format(end)}`
}

function slotKey(date: string, meal: MealType) {
  return `${date}:${meal}`
}

export default function MenuSection() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [entries, setEntries] = useState<MenuEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<SlotDraft | null>(null)

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index)
      return { date: localDateString(date), label: dayLabels[index] }
    }),
    [weekStart],
  )

  const entriesBySlot = useMemo(() => {
    const map = new Map<string, MenuEntry>()
    entries.forEach((entry) => map.set(slotKey(entry.planned_date, entry.meal), entry))
    return map
  }, [entries])

  const loadRecipes = useCallback(async () => {
    if (!supabase) return
    const { data, error: queryError } = await supabase
      .from('recipes')
      .select('id, name, base_servings')
      .order('name')

    if (queryError) throw queryError
    setRecipes((data ?? []) as Recipe[])
  }, [])

  const loadWeek = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError('')
    try {
      const from = localDateString(weekStart)
      const to = localDateString(addDays(weekStart, 6))
      const { data, error: queryError } = await supabase
        .from('menu_entries')
        .select(`
          id,
          planned_date,
          meal,
          is_eating_out,
          completed_at,
          menu_entry_recipes (
            id,
            recipe_id,
            servings,
            sort_order,
            recipe:recipes (id, name)
          )
        `)
        .gte('planned_date', from)
        .lte('planned_date', to)
        .order('planned_date')

      if (queryError) throw queryError
      setEntries((data ?? []) as unknown as MenuEntry[])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el menú.')
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => {
    void loadRecipes().catch((cause) => setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las recetas.'))
  }, [loadRecipes])

  useEffect(() => {
    void loadWeek()
  }, [loadWeek])

  const openSlot = (date: string, meal: MealType) => {
    const current = entriesBySlot.get(slotKey(date, meal))
    setDraft({
      date,
      meal,
      mode: current?.is_eating_out ? 'eating_out' : 'recipes',
      recipes: current?.menu_entry_recipes
        ?.slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => ({ recipeId: item.recipe_id, servings: String(item.servings) })) ?? [],
    })
    setError('')
  }

  const saveSlot = async () => {
    if (!supabase || !draft) return

    const current = entriesBySlot.get(slotKey(draft.date, draft.meal))
    const validRecipes = draft.recipes.filter((item) => item.recipeId && Number(item.servings) > 0)

    if (draft.mode === 'recipes' && draft.recipes.length > 0 && validRecipes.length !== draft.recipes.length) {
      setError('Revisa las recetas y raciones antes de guardar.')
      return
    }

    setSaving(true)
    setError('')
    try {
      if (draft.mode === 'recipes' && validRecipes.length === 0) {
        if (current) {
          const { error: deleteError } = await supabase.from('menu_entries').delete().eq('id', current.id)
          if (deleteError) throw deleteError
        }
        setDraft(null)
        await loadWeek()
        return
      }

      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) throw userError ?? new Error('No se ha encontrado la sesión.')

      let entryId = current?.id
      if (current) {
        const { error: updateError } = await supabase
          .from('menu_entries')
          .update({ is_eating_out: draft.mode === 'eating_out' })
          .eq('id', current.id)
        if (updateError) throw updateError
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('menu_entries')
          .insert({
            user_id: userData.user.id,
            planned_date: draft.date,
            meal: draft.meal,
            is_eating_out: draft.mode === 'eating_out',
          })
          .select('id')
          .single()
        if (insertError) throw insertError
        entryId = inserted.id
      }

      if (!entryId) throw new Error('No se pudo guardar la franja del menú.')

      const { error: clearError } = await supabase.from('menu_entry_recipes').delete().eq('menu_entry_id', entryId)
      if (clearError) throw clearError

      if (draft.mode === 'recipes' && validRecipes.length > 0) {
        const uniqueRecipeIds = new Set<string>()
        for (const item of validRecipes) {
          if (uniqueRecipeIds.has(item.recipeId)) throw new Error('Una misma receta no puede añadirse dos veces en la misma comida.')
          uniqueRecipeIds.add(item.recipeId)
        }

        const { error: recipesError } = await supabase.from('menu_entry_recipes').insert(
          validRecipes.map((item, index) => ({
            menu_entry_id: entryId,
            recipe_id: item.recipeId,
            servings: Number(item.servings),
            sort_order: index,
          })),
        )
        if (recipesError) throw recipesError
      }

      setDraft(null)
      await loadWeek()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el menú.')
    } finally {
      setSaving(false)
    }
  }

  const clearSlot = async () => {
    if (!supabase || !draft) return
    const current = entriesBySlot.get(slotKey(draft.date, draft.meal))
    if (!current) {
      setDraft(null)
      return
    }

    setSaving(true)
    setError('')
    const { error: deleteError } = await supabase.from('menu_entries').delete().eq('id', current.id)
    setSaving(false)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setDraft(null)
    await loadWeek()
  }

  const selectedMealLabel = draft ? mealTypes.find((item) => item.id === draft.meal)?.label : ''

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-500">Planificación semanal</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">Tu menú</h1>
          <p className="mt-2 text-sm text-neutral-500">{formatWeekRange(weekStart)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:bg-neutral-50"
            aria-label="Semana anterior"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
          >
            Esta semana
          </button>
          <button
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 shadow-sm hover:bg-neutral-50"
            aria-label="Semana siguiente"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </header>

      {error && !draft && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-sm text-neutral-500 shadow-sm">Cargando menú…</div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {weekDays.map((day) => {
            const today = day.date === localDateString(new Date())
            return (
              <section key={day.date} className={`rounded-3xl border bg-white p-5 shadow-sm ${today ? 'border-neutral-400' : 'border-neutral-200'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-900">{day.label}</h2>
                    <p className="mt-0.5 text-xs text-neutral-400">{formatShortDate(day.date)}{today ? ' · Hoy' : ''}</p>
                  </div>
                  <CalendarDays size={18} className="text-neutral-300" />
                </div>

                <div className="mt-4 divide-y divide-neutral-100">
                  {mealTypes.map((meal) => {
                    const entry = entriesBySlot.get(slotKey(day.date, meal.id))
                    const planned = entry?.menu_entry_recipes?.slice().sort((a, b) => a.sort_order - b.sort_order) ?? []
                    return (
                      <button
                        key={meal.id}
                        onClick={() => openSlot(day.date, meal.id)}
                        className="flex w-full items-start justify-between gap-4 py-3 text-left first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-neutral-800">{meal.label}</p>
                          {entry?.is_eating_out ? (
                            <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-neutral-500"><UtensilsCrossed size={13} /> Comida fuera</p>
                          ) : planned.length > 0 ? (
                            <div className="mt-1 space-y-1">
                              {planned.map((item) => (
                                <p key={item.id} className="truncate text-xs text-neutral-500">
                                  {item.recipe?.name ?? 'Receta'} · {Number(item.servings).toLocaleString('es-ES')} {Number(item.servings) === 1 ? 'ración' : 'raciones'}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="mt-1 text-xs text-neutral-400">Sin planificar</p>
                          )}
                        </div>
                        <span className="mt-0.5 shrink-0 rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50">
                          {entry ? 'Editar' : 'Añadir'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && !saving && setDraft(null)}>
          <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-neutral-500">{formatShortDate(draft.date)}</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">{selectedMealLabel}</h2>
              </div>
              <button disabled={saving} onClick={() => setDraft(null)} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-100" aria-label="Cerrar">
                <X size={19} />
              </button>
            </div>

            <div className="mt-6 grid grid-cols-2 rounded-2xl bg-neutral-100 p-1">
              <button
                onClick={() => setDraft({ ...draft, mode: 'recipes' })}
                className={`rounded-xl px-3 py-2 text-sm font-medium ${draft.mode === 'recipes' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}
              >
                Recetas
              </button>
              <button
                onClick={() => setDraft({ ...draft, mode: 'eating_out', recipes: [] })}
                className={`rounded-xl px-3 py-2 text-sm font-medium ${draft.mode === 'eating_out' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}
              >
                Comida fuera
              </button>
            </div>

            {draft.mode === 'eating_out' ? (
              <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-600">
                Esta franja no añadirá ingredientes a la lista de la compra ni descontará productos de la despensa.
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {draft.recipes.map((item, index) => (
                  <div key={`${item.recipeId}-${index}`} className="grid grid-cols-[minmax(0,1fr)_90px_40px] gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 p-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Receta</label>
                      <select
                        value={item.recipeId}
                        onChange={(event) => {
                          const next = [...draft.recipes]
                          next[index] = { ...next[index], recipeId: event.target.value }
                          setDraft({ ...draft, recipes: next })
                        }}
                        className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
                      >
                        <option value="">Seleccionar…</option>
                        {recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Raciones</label>
                      <input
                        type="number"
                        min="0.25"
                        step="0.25"
                        value={item.servings}
                        onChange={(event) => {
                          const next = [...draft.recipes]
                          next[index] = { ...next[index], servings: event.target.value }
                          setDraft({ ...draft, recipes: next })
                        }}
                        className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
                      />
                    </div>
                    <button
                      onClick={() => setDraft({ ...draft, recipes: draft.recipes.filter((_, recipeIndex) => recipeIndex !== index) })}
                      className="mt-5 grid h-10 w-10 place-items-center rounded-xl text-neutral-400 hover:bg-white hover:text-red-500"
                      aria-label="Quitar receta"
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}

                {recipes.length === 0 ? (
                  <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Primero necesitas crear alguna receta.</p>
                ) : (
                  <button
                    onClick={() => setDraft({ ...draft, recipes: [...draft.recipes, { recipeId: '', servings: '1' }] })}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-300 px-4 py-3 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                  >
                    <Plus size={16} /> Añadir receta
                  </button>
                )}
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button
                disabled={saving}
                onClick={() => void clearSlot()}
                className="rounded-2xl px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Dejar sin planificar
              </button>
              <button
                disabled={saving}
                onClick={() => void saveSlot()}
                className="rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
