import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { PackagePlus, Pencil, Search, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

const units = ['g', 'kg', 'ml', 'l', 'unidad', 'cucharada', 'cucharadita', 'taza', 'lata', 'paquete'] as const
const categories = ['Fruta y verdura', 'Carne', 'Pescado y marisco', 'Lácteos y huevos', 'Panadería', 'Despensa', 'Congelados', 'Bebidas', 'Salsas y condimentos', 'Otros'] as const

type Unit = (typeof units)[number]
type Ingredient = {
  id: string
  name: string
  category: string | null
  default_unit: Unit | null
}

type ProductForm = {
  name: string
  category: string
  defaultUnit: Unit
}

const emptyForm = (): ProductForm => ({
  name: '',
  category: 'Despensa',
  defaultUnit: 'unidad',
})

export default function ProductCatalogSection() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Ingredient | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyForm())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError(null)
    const { data, error: loadError } = await supabase
      .from('ingredients')
      .select('id,name,category,default_unit')
      .order('name')

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    setIngredients((data ?? []) as Ingredient[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return ingredients
    return ingredients.filter((ingredient) =>
      [ingredient.name, ingredient.category ?? '', ingredient.default_unit ?? '']
        .some((text) => text.toLowerCase().includes(value))
    )
  }, [ingredients, query])

  const grouped = useMemo(() => {
    const groups = new Map<string, Ingredient[]>()
    filtered.forEach((ingredient) => {
      const category = ingredient.category ?? 'Otros'
      groups.set(category, [...(groups.get(category) ?? []), ingredient])
    })
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b, 'es'))
  }, [filtered])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setError(null)
    setFormOpen(true)
  }

  function openEdit(ingredient: Ingredient) {
    setEditing(ingredient)
    setForm({
      name: ingredient.name,
      category: ingredient.category ?? 'Otros',
      defaultUnit: ingredient.default_unit ?? 'unidad',
    })
    setError(null)
    setFormOpen(true)
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return

    const name = form.name.trim()
    if (!name) {
      setError('Indica un nombre para el producto.')
      return
    }

    setSaving(true)
    setError(null)

    const { data: authData, error: authError } = await supabase.auth.getUser()
    if (authError || !authData.user) {
      setError('No se pudo identificar tu usuario.')
      setSaving(false)
      return
    }

    const payload = {
      name,
      category: form.category,
      default_unit: form.defaultUnit,
    }

    const result = editing
      ? await supabase.from('ingredients').update(payload).eq('id', editing.id)
      : await supabase.from('ingredients').insert({ ...payload, user_id: authData.user.id })

    setSaving(false)

    if (result.error) {
      setError(result.error.message.includes('ingredients_user_id_name_key')
        ? 'Ya existe un producto con ese nombre.'
        : result.error.message)
      return
    }

    setFormOpen(false)
    setEditing(null)
    await load()
  }

  async function deleteProduct(ingredient: Ingredient) {
    if (!supabase) return
    if (!window.confirm(`¿Eliminar “${ingredient.name}” del catálogo? Si ya se ha usado en recetas, compras, menú o consumos, se conservará para proteger el histórico.`)) return

    setDeletingId(ingredient.id)
    setError(null)
    const { error: deleteError } = await supabase.rpc('delete_unused_ingredient', {
      p_ingredient_id: ingredient.id,
    })
    setDeletingId(null)

    if (deleteError) {
      setError(deleteError.message)
      return
    }

    await load()
  }

  if (formOpen) {
    return <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-neutral-500">Catálogo de productos</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">{editing ? 'Editar producto' : 'Crear producto'}</h2>
        </div>
        <button type="button" onClick={() => setFormOpen(false)} className="rounded-2xl border border-neutral-200 bg-white p-2.5 text-neutral-600 shadow-sm" aria-label="Cerrar">
          <X size={19} />
        </button>
      </div>

      <form onSubmit={saveProduct} className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid gap-4">
          <label className="text-sm font-medium text-neutral-700">
            Nombre
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. Arroz basmati" className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-neutral-400" />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-neutral-700">
              Categoría
              <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm">
                {categories.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>

            <label className="text-sm font-medium text-neutral-700">
              Unidad habitual
              <select value={form.defaultUnit} onChange={(event) => setForm((current) => ({ ...current, defaultUnit: event.target.value as Unit }))} className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm">
                {units.map((unit) => <option key={unit}>{unit}</option>)}
              </select>
            </label>
          </div>
        </div>

        {editing && <p className="mt-4 rounded-2xl bg-neutral-50 px-4 py-3 text-xs leading-5 text-neutral-500">Los cambios de nombre, categoría o unidad habitual se reflejarán en toda la app porque el producto conserva su identificador.</p>}
        {error && <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <button type="submit" disabled={saving} className="mt-5 rounded-2xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear producto'}
        </button>
      </form>
    </div>
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-neutral-500">Catálogo</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">Productos creados</h2>
        <p className="mt-2 text-sm text-neutral-500">Gestiona todos los productos disponibles, estén o no actualmente en tu despensa.</p>
      </div>
      <button onClick={openCreate} className="flex items-center gap-2 rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white">
        <PackagePlus size={17} /> Nuevo producto
      </button>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-xs text-neutral-400">Productos creados</p>
        <p className="mt-1 text-2xl font-semibold">{ingredients.length}</p>
      </div>
      <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
        <p className="text-xs text-neutral-400">Categorías</p>
        <p className="mt-1 text-2xl font-semibold">{new Set(ingredients.map((ingredient) => ingredient.category ?? 'Otros')).size}</p>
      </div>
    </div>

    <div className="relative">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={17} />
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, categoría o unidad" className="w-full rounded-2xl border border-neutral-200 bg-white py-3 pl-11 pr-4 text-sm shadow-sm outline-none focus:border-neutral-400" />
    </div>

    {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

    {loading ? <div className="rounded-3xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500 shadow-sm">Cargando productos…</div>
      : filtered.length === 0 ? <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <PackagePlus className="mx-auto text-neutral-300" size={32} />
          <h3 className="mt-4 text-lg font-semibold">{ingredients.length ? 'No hay resultados' : 'Todavía no hay productos'}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">Crea productos aquí y después podrás utilizarlos en despensa, recetas, menú y tickets.</p>
          {!ingredients.length && <button onClick={openCreate} className="mt-5 rounded-2xl bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white">Crear producto</button>}
        </div>
      : <div className="grid items-start gap-4 xl:grid-cols-2">
          {grouped.map(([category, categoryItems]) => <section key={category} className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-800">{category}</h3>
              <span className="rounded-full bg-white px-2 py-0.5 text-xs text-neutral-400">{categoryItems.length}</span>
            </div>
            <div className="divide-y divide-neutral-100">
              {categoryItems.map((ingredient) => <article key={ingredient.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900">{ingredient.name}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">Unidad habitual: {ingredient.default_unit ?? 'sin definir'}</p>
                </div>
                <div className="flex shrink-0">
                  <button onClick={() => openEdit(ingredient)} className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label={`Editar ${ingredient.name}`}>
                    <Pencil size={15} />
                  </button>
                  <button disabled={deletingId === ingredient.id} onClick={() => void deleteProduct(ingredient)} className="rounded-lg p-2 text-neutral-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-40" aria-label={`Eliminar ${ingredient.name}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>)}
            </div>
          </section>)}
        </div>}
  </div>
}
