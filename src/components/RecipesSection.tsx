import { ChevronLeft, Clock3, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const units = ['g', 'kg', 'ml', 'l', 'unidad', 'cucharada', 'cucharadita', 'taza', 'lata', 'paquete'] as const
const categories = [
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
] as const

type Unit = (typeof units)[number]

type Ingredient = {
  id: string
  name: string
  category: string | null
  default_unit: Unit | null
}

type RecipeIngredient = {
  id: string
  quantity: number
  unit: Unit
  notes: string | null
  ingredient: Ingredient
}

type RecipeStep = {
  id: string
  step_number: number
  instruction: string
}

type Recipe = {
  id: string
  name: string
  description: string | null
  preparation_minutes: number | null
  base_servings: number
  calories_per_serving: number | null
  protein_g_per_serving: number | null
  carbs_g_per_serving: number | null
  fiber_g_per_serving: number | null
  fat_g_per_serving: number | null
  sugar_g_per_serving: number | null
  recipe_ingredients: RecipeIngredient[]
  recipe_steps: RecipeStep[]
}

type IngredientDraft = {
  ingredientId: string
  name: string
  category: string
  quantity: string
  unit: Unit
  notes: string
  isNew: boolean
}

type FormState = {
  name: string
  description: string
  preparationMinutes: string
  servings: string
  calories: string
  protein: string
  carbs: string
  fiber: string
  fat: string
  sugar: string
  ingredients: IngredientDraft[]
  steps: string[]
}

const emptyForm = (): FormState => ({
  name: '',
  description: '',
  preparationMinutes: '',
  servings: '1',
  calories: '',
  protein: '',
  carbs: '',
  fiber: '',
  fat: '',
  sugar: '',
  ingredients: [],
  steps: [''],
})

const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value))

function IngredientEditor({
  value,
  ingredients,
  onChange,
  onRemove,
}: {
  value: IngredientDraft
  ingredients: Ingredient[]
  onChange: (next: IngredientDraft) => void
  onRemove: () => void
}) {
  const [showMatches, setShowMatches] = useState(false)
  const matches = useMemo(() => {
    const term = value.name.trim().toLocaleLowerCase('es')
    if (!term) return ingredients.slice(0, 6)
    return ingredients.filter((item) => item.name.toLocaleLowerCase('es').includes(term)).slice(0, 6)
  }, [ingredients, value.name])

  const selectIngredient = (ingredient: Ingredient) => {
    onChange({
      ...value,
      ingredientId: ingredient.id,
      name: ingredient.name,
      category: ingredient.category ?? 'Otros',
      unit: ingredient.default_unit ?? value.unit,
      isNew: false,
    })
    setShowMatches(false)
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(120px,0.8fr)_minmax(110px,0.8fr)_auto]">
        <div className="relative">
          <label className="mb-1.5 block text-xs font-medium text-neutral-500">Ingrediente</label>
          <input
            value={value.name}
            onFocus={() => setShowMatches(true)}
            onChange={(event) => {
              const name = event.target.value
              const exact = ingredients.find((item) => item.name.toLocaleLowerCase('es') === name.trim().toLocaleLowerCase('es'))
              onChange({
                ...value,
                name,
                ingredientId: exact?.id ?? '',
                category: exact?.category ?? value.category,
                unit: exact?.default_unit ?? value.unit,
                isNew: !exact,
              })
              setShowMatches(true)
            }}
            placeholder="Ej. Arroz basmati"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-neutral-400"
          />
          {showMatches && value.name.trim() && (
            <div className="absolute z-20 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
              {matches.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectIngredient(item)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-50"
                >
                  <span>{item.name}</span>
                  <span className="text-xs text-neutral-400">{item.category ?? 'Sin categoría'}</span>
                </button>
              ))}
              {!matches.some((item) => item.name.toLocaleLowerCase('es') === value.name.trim().toLocaleLowerCase('es')) && (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setShowMatches(false)}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  + Crear “{value.name.trim()}”
                </button>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-500">Cantidad</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={value.quantity}
            onChange={(event) => onChange({ ...value, quantity: event.target.value })}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-500">Unidad</label>
          <select
            value={value.unit}
            onChange={(event) => onChange({ ...value, unit: event.target.value as Unit })}
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
          >
            {units.map((unit) => <option key={unit}>{unit}</option>)}
          </select>
        </div>

        <button type="button" onClick={onRemove} className="mt-6 grid h-10 w-10 place-items-center rounded-xl text-neutral-400 hover:bg-white hover:text-red-500">
          <Trash2 size={17} />
        </button>
      </div>

      {value.isNew && value.name.trim() && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-500">Categoría de compra</label>
            <select
              value={value.category}
              onChange={(event) => onChange({ ...value, category: event.target.value })}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
            >
              {categories.map((category) => <option key={category}>{category}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-neutral-500">Nota opcional</label>
            <input
              value={value.notes}
              onChange={(event) => onChange({ ...value, notes: event.target.value })}
              placeholder="Ej. sin piel"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
            />
          </div>
        </div>
      )}
      {!value.isNew && (
        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium text-neutral-500">Nota opcional</label>
          <input
            value={value.notes}
            onChange={(event) => onChange({ ...value, notes: event.target.value })}
            placeholder="Ej. bien escurrido"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
          />
        </div>
      )}
    </div>
  )
}

export default function RecipesSection() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError(null)
    const [{ data: recipeData, error: recipeError }, { data: ingredientData, error: ingredientError }] = await Promise.all([
      supabase
        .from('recipes')
        .select('*, recipe_ingredients(id, quantity, unit, notes, ingredient:ingredients(id, name, category, default_unit)), recipe_steps(id, step_number, instruction)')
        .order('name'),
      supabase.from('ingredients').select('id, name, category, default_unit').order('name'),
    ])

    if (recipeError || ingredientError) {
      setError(recipeError?.message ?? ingredientError?.message ?? 'No se pudieron cargar los datos.')
    } else {
      const normalized = ((recipeData ?? []) as unknown as Recipe[]).map((recipe) => ({
        ...recipe,
        recipe_ingredients: [...(recipe.recipe_ingredients ?? [])],
        recipe_steps: [...(recipe.recipe_steps ?? [])].sort((a, b) => a.step_number - b.step_number),
      }))
      setRecipes(normalized)
      setIngredients((ingredientData ?? []) as Ingredient[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadData() }, [loadData])

  const filteredRecipes = recipes.filter((recipe) => recipe.name.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')))

  const startCreate = () => {
    setEditingId(null)
    setForm(emptyForm())
    setError(null)
    setMode('form')
  }

  const startEdit = (recipe: Recipe) => {
    setEditingId(recipe.id)
    setForm({
      name: recipe.name,
      description: recipe.description ?? '',
      preparationMinutes: recipe.preparation_minutes?.toString() ?? '',
      servings: recipe.base_servings.toString(),
      calories: recipe.calories_per_serving?.toString() ?? '',
      protein: recipe.protein_g_per_serving?.toString() ?? '',
      carbs: recipe.carbs_g_per_serving?.toString() ?? '',
      fiber: recipe.fiber_g_per_serving?.toString() ?? '',
      fat: recipe.fat_g_per_serving?.toString() ?? '',
      sugar: recipe.sugar_g_per_serving?.toString() ?? '',
      ingredients: recipe.recipe_ingredients.map((item) => ({
        ingredientId: item.ingredient.id,
        name: item.ingredient.name,
        category: item.ingredient.category ?? 'Otros',
        quantity: item.quantity.toString(),
        unit: item.unit,
        notes: item.notes ?? '',
        isNew: false,
      })),
      steps: recipe.recipe_steps.length ? recipe.recipe_steps.map((step) => step.instruction) : [''],
    })
    setError(null)
    setMode('form')
  }

  const saveRecipe = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    if (!form.name.trim()) return setError('La receta necesita un nombre.')
    if (Number(form.servings) <= 0) return setError('Las raciones deben ser mayores que cero.')
    if (form.ingredients.some((item) => !item.name.trim() || Number(item.quantity) <= 0)) return setError('Revisa los ingredientes y sus cantidades.')

    setSaving(true)
    setError(null)

    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) {
      setError('No se ha podido identificar tu sesión.')
      setSaving(false)
      return
    }

    const payload = {
      user_id: userData.user.id,
      name: form.name.trim(),
      description: form.description.trim() || null,
      preparation_minutes: numberOrNull(form.preparationMinutes),
      base_servings: Number(form.servings),
      calories_per_serving: numberOrNull(form.calories),
      protein_g_per_serving: numberOrNull(form.protein),
      carbs_g_per_serving: numberOrNull(form.carbs),
      fiber_g_per_serving: numberOrNull(form.fiber),
      fat_g_per_serving: numberOrNull(form.fat),
      sugar_g_per_serving: numberOrNull(form.sugar),
    }

    let recipeId = editingId
    if (editingId) {
      const { error: updateError } = await supabase.from('recipes').update(payload).eq('id', editingId)
      if (updateError) return finishWithError(updateError.message)
      const { error: deleteIngredientsError } = await supabase.from('recipe_ingredients').delete().eq('recipe_id', editingId)
      if (deleteIngredientsError) return finishWithError(deleteIngredientsError.message)
      const { error: deleteStepsError } = await supabase.from('recipe_steps').delete().eq('recipe_id', editingId)
      if (deleteStepsError) return finishWithError(deleteStepsError.message)
    } else {
      const { data, error: insertError } = await supabase.from('recipes').insert(payload).select('id').single()
      if (insertError || !data) return finishWithError(insertError?.message ?? 'No se pudo crear la receta.')
      recipeId = data.id
    }

    const resolvedIngredientRows: Array<{ ingredient_id: string; quantity: number; unit: Unit; notes: string | null; sort_order: number }> = []
    for (let index = 0; index < form.ingredients.length; index += 1) {
      const item = form.ingredients[index]
      let ingredientId = item.ingredientId
      if (!ingredientId) {
        const existing = ingredients.find((ingredient) => ingredient.name.toLocaleLowerCase('es') === item.name.trim().toLocaleLowerCase('es'))
        if (existing) {
          ingredientId = existing.id
        } else {
          const { data, error: ingredientError } = await supabase
            .from('ingredients')
            .insert({
              user_id: userData.user.id,
              name: item.name.trim(),
              category: item.category || 'Otros',
              default_unit: item.unit,
            })
            .select('id')
            .single()
          if (ingredientError || !data) return finishWithError(ingredientError?.message ?? `No se pudo crear ${item.name}.`)
          ingredientId = data.id
        }
      }
      resolvedIngredientRows.push({
        ingredient_id: ingredientId,
        quantity: Number(item.quantity),
        unit: item.unit,
        notes: item.notes.trim() || null,
        sort_order: index,
      })
    }

    if (recipeId && resolvedIngredientRows.length) {
      const { error: ingredientLinkError } = await supabase.from('recipe_ingredients').insert(
        resolvedIngredientRows.map((row) => ({ ...row, recipe_id: recipeId })),
      )
      if (ingredientLinkError) return finishWithError(ingredientLinkError.message)
    }

    const stepRows = form.steps.map((step) => step.trim()).filter(Boolean)
    if (recipeId && stepRows.length) {
      const { error: stepsError } = await supabase.from('recipe_steps').insert(
        stepRows.map((instruction, index) => ({ recipe_id: recipeId, step_number: index + 1, instruction })),
      )
      if (stepsError) return finishWithError(stepsError.message)
    }

    setSaving(false)
    setMode('list')
    setForm(emptyForm())
    setEditingId(null)
    await loadData()

    function finishWithError(message: string) {
      setError(message)
      setSaving(false)
    }
  }

  const deleteRecipe = async (recipe: Recipe) => {
    if (!supabase || !window.confirm(`¿Eliminar “${recipe.name}”?`)) return
    const { error: deleteError } = await supabase.from('recipes').delete().eq('id', recipe.id)
    if (deleteError) setError(deleteError.message)
    else await loadData()
  }

  if (mode === 'form') {
    return (
      <form onSubmit={saveRecipe} className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setMode('list')} className="grid h-10 w-10 place-items-center rounded-xl border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50">
              <ChevronLeft size={19} />
            </button>
            <div>
              <p className="text-sm font-medium text-neutral-500">Recetas</p>
              <h1 className="text-2xl font-semibold tracking-tight text-neutral-950">{editingId ? 'Editar receta' : 'Nueva receta'}</h1>
            </div>
          </div>
          <button disabled={saving} className="rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold">Información básica</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-medium">Nombre</label>
              <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full rounded-xl border border-neutral-200 px-3.5 py-2.5 outline-none focus:border-neutral-400" />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-medium">Descripción</label>
              <textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="w-full resize-none rounded-xl border border-neutral-200 px-3.5 py-2.5 outline-none focus:border-neutral-400" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Tiempo de preparación (min)</label>
              <input type="number" min="0" value={form.preparationMinutes} onChange={(event) => setForm({ ...form, preparationMinutes: event.target.value })} className="w-full rounded-xl border border-neutral-200 px-3.5 py-2.5 outline-none focus:border-neutral-400" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Raciones base</label>
              <input required type="number" min="0.1" step="0.1" value={form.servings} onChange={(event) => setForm({ ...form, servings: event.target.value })} className="w-full rounded-xl border border-neutral-200 px-3.5 py-2.5 outline-none focus:border-neutral-400" />
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Ingredientes</h2>
              <p className="mt-1 text-sm text-neutral-500">Las cantidades corresponden a las raciones base.</p>
            </div>
            <button
              type="button"
              onClick={() => setForm({ ...form, ingredients: [...form.ingredients, { ingredientId: '', name: '', category: 'Otros', quantity: '', unit: 'g', notes: '', isNew: true }] })}
              className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium hover:bg-neutral-50"
            >
              <Plus size={16} /> Añadir
            </button>
          </div>
          <div className="mt-4 space-y-3">
            {form.ingredients.length === 0 && <p className="rounded-2xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-400">Añade los ingredientes de la receta.</p>}
            {form.ingredients.map((item, index) => (
              <IngredientEditor
                key={index}
                value={item}
                ingredients={ingredients}
                onChange={(next) => setForm({ ...form, ingredients: form.ingredients.map((current, itemIndex) => itemIndex === index ? next : current) })}
                onRemove={() => setForm({ ...form, ingredients: form.ingredients.filter((_, itemIndex) => itemIndex !== index) })}
              />
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Pasos</h2>
            <button type="button" onClick={() => setForm({ ...form, steps: [...form.steps, ''] })} className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-medium hover:bg-neutral-50"><Plus size={16} /> Paso</button>
          </div>
          <div className="mt-4 space-y-3">
            {form.steps.map((step, index) => (
              <div key={index} className="flex gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100 text-sm font-semibold text-neutral-500">{index + 1}</span>
                <textarea
                  rows={2}
                  value={step}
                  onChange={(event) => setForm({ ...form, steps: form.steps.map((current, stepIndex) => stepIndex === index ? event.target.value : current) })}
                  className="min-h-10 flex-1 resize-y rounded-xl border border-neutral-200 px-3.5 py-2.5 text-sm outline-none focus:border-neutral-400"
                />
                {form.steps.length > 1 && <button type="button" onClick={() => setForm({ ...form, steps: form.steps.filter((_, stepIndex) => stepIndex !== index) })} className="grid h-10 w-10 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-50 hover:text-red-500"><X size={17} /></button>}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
          <div>
            <h2 className="text-base font-semibold">Información nutricional</h2>
            <p className="mt-1 text-sm text-neutral-500">Valores por ración.</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
            {[
              ['Calorías', 'calories', 'kcal'], ['Proteínas', 'protein', 'g'], ['Carbohidratos', 'carbs', 'g'],
              ['Fibra', 'fiber', 'g'], ['Grasas', 'fat', 'g'], ['Azúcar', 'sugar', 'g'],
            ].map(([label, key, suffix]) => (
              <label key={key} className="text-sm font-medium">
                {label}
                <div className="mt-1.5 flex items-center rounded-xl border border-neutral-200 bg-white pr-3 focus-within:border-neutral-400">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form[key as keyof Pick<FormState, 'calories' | 'protein' | 'carbs' | 'fiber' | 'fat' | 'sugar'>] as string}
                    onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                    className="min-w-0 flex-1 rounded-xl px-3.5 py-2.5 outline-none"
                  />
                  <span className="text-xs text-neutral-400">{suffix}</span>
                </div>
              </label>
            ))}
          </div>
        </section>
      </form>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-neutral-500">Tu colección</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">Recetas</h1>
        </div>
        <button onClick={startCreate} className="flex items-center justify-center gap-2 rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-700">
          <Plus size={17} /> Nueva receta
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={17} />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar receta…" className="w-full rounded-2xl border border-neutral-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-neutral-400" />
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="rounded-3xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">Cargando recetas…</div>
      ) : filteredRecipes.length === 0 ? (
        <div className="rounded-3xl border border-neutral-200 bg-white p-10 text-center shadow-sm">
          <ChefIcon />
          <h2 className="mt-4 text-lg font-semibold">{recipes.length ? 'No hay coincidencias' : 'Todavía no tienes recetas'}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-neutral-500">{recipes.length ? 'Prueba con otro nombre.' : 'Crea tu primera receta para empezar a planificar el menú semanal.'}</p>
          {!recipes.length && <button onClick={startCreate} className="mt-5 rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white">Crear primera receta</button>}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredRecipes.map((recipe) => (
            <article key={recipe.id} className="flex flex-col rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-900">{recipe.name}</h2>
                  {recipe.description && <p className="mt-1 line-clamp-2 text-sm leading-5 text-neutral-500">{recipe.description}</p>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(recipe)} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700" aria-label="Editar"><Pencil size={16} /></button>
                  <button onClick={() => void deleteRecipe(recipe)} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-400 hover:bg-red-50 hover:text-red-600" aria-label="Eliminar"><Trash2 size={16} /></button>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2 text-xs text-neutral-500">
                <span className="rounded-full bg-neutral-100 px-2.5 py-1">{recipe.base_servings} raciones</span>
                {recipe.preparation_minutes !== null && <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1"><Clock3 size={12} /> {recipe.preparation_minutes} min</span>}
                <span className="rounded-full bg-neutral-100 px-2.5 py-1">{recipe.recipe_ingredients.length} ingredientes</span>
              </div>
              <div className="mt-4 border-t border-neutral-100 pt-4">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Por ración</p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div><p className="font-semibold">{recipe.calories_per_serving ?? '—'}</p><p className="text-xs text-neutral-400">kcal</p></div>
                  <div><p className="font-semibold">{recipe.protein_g_per_serving ?? '—'}</p><p className="text-xs text-neutral-400">proteína</p></div>
                  <div><p className="font-semibold">{recipe.carbs_g_per_serving ?? '—'}</p><p className="text-xs text-neutral-400">carbos</p></div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function ChefIcon() {
  return <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-neutral-100 text-xl">🍳</div>
}
