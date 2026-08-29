import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const units = ['g', 'kg', 'ml', 'l', 'unidad', 'cucharada', 'cucharadita', 'taza', 'lata', 'paquete'] as const
type Unit = (typeof units)[number]

type IngredientRow = {
  ingredient_id: string
  quantity: number
  unit: Unit
  ingredient: { id: string; name: string } | null
}

type PantryRow = {
  ingredient_id: string
  quantity: number | null
  unit: Unit | null
  status: 'tengo' | 'queda_poco' | 'no_tengo' | null
}

type DraftItem = {
  ingredientId: string
  name: string
  quantity: string
  unit: Unit
  pantry: PantryRow | null
}

type Props = {
  entryId: string
  recipeId: string
  recipeName: string
  servings: number
  onClose: () => void
  onCompleted: () => void
}

function formatNumber(value: number) {
  return value.toLocaleString('es-ES', { maximumFractionDigits: 3 })
}

function compatible(quantity: number, from: Unit, to: Unit) {
  if (from === to) return quantity
  if (from === 'g' && to === 'kg') return quantity / 1000
  if (from === 'kg' && to === 'g') return quantity * 1000
  if (from === 'ml' && to === 'l') return quantity / 1000
  if (from === 'l' && to === 'ml') return quantity * 1000
  return null
}

export default function CompleteRecipeModal({ entryId, recipeId, recipeName, servings, onClose, onCompleted }: Props) {
  const [items, setItems] = useState<DraftItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const client = supabase
    if (!client) return

    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const { data: recipe, error: recipeError } = await client
          .from('recipes')
          .select(`
            base_servings,
            recipe_ingredients (
              ingredient_id,
              quantity,
              unit,
              ingredient:ingredients (id, name)
            )
          `)
          .eq('id', recipeId)
          .single()
        if (recipeError) throw recipeError

        const ingredients = (recipe.recipe_ingredients ?? []) as unknown as IngredientRow[]
        const ingredientIds = ingredients.map((item) => item.ingredient_id)
        const pantryMap = new Map<string, PantryRow>()

        if (ingredientIds.length > 0) {
          const { data: pantry, error: pantryError } = await client
            .from('pantry_items')
            .select('ingredient_id, quantity, unit, status')
            .in('ingredient_id', ingredientIds)
          if (pantryError) throw pantryError
          ;((pantry ?? []) as PantryRow[]).forEach((item) => pantryMap.set(item.ingredient_id, item))
        }

        const scale = servings / Number(recipe.base_servings || 1)
        setItems(
          ingredients.map((item) => ({
            ingredientId: item.ingredient_id,
            name: item.ingredient?.name ?? 'Ingrediente',
            quantity: String(Number(item.quantity) * scale),
            unit: item.unit,
            pantry: pantryMap.get(item.ingredient_id) ?? null,
          })),
        )
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'No se pudo preparar el consumo.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [recipeId, servings])

  const warnings = useMemo(
    () => items.filter((item) => {
      if (!item.pantry) return true
      if (item.pantry.quantity === null || !item.pantry.unit) return true
      return compatible(Number(item.quantity || 0), item.unit, item.pantry.unit) === null
    }).length,
    [items],
  )

  const confirm = async () => {
    const client = supabase
    if (!client) return
    if (items.some((item) => item.quantity.trim() === '' || Number(item.quantity) < 0)) {
      setError('Revisa las cantidades antes de confirmar.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const { error: rpcError } = await client.rpc('complete_planned_recipe', {
        p_menu_entry_id: entryId,
        p_recipe_id: recipeId,
        p_servings: servings,
        p_items: items.map((item) => ({
          ingredient_id: item.ingredientId,
          quantity: Number(item.quantity),
          unit: item.unit,
        })),
      })
      if (rpcError) throw rpcError
      onCompleted()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo completar la receta.'
      setError(message.includes('already been completed') ? 'Esta receta ya estaba completada. No se ha descontado nada de nuevo.' : message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-2xl sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-neutral-500">Confirmar consumo</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-neutral-950">{recipeName}</h2>
            <p className="mt-1 text-sm text-neutral-500">{formatNumber(servings)} {servings === 1 ? 'ración' : 'raciones'}</p>
          </div>
          <button disabled={saving} onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-100" aria-label="Cerrar">
            <X size={19} />
          </button>
        </div>

        <p className="mt-5 text-sm leading-6 text-neutral-600">
          Revisa lo que realmente has utilizado. Puedes ajustar cualquier cantidad antes de descontarla de la despensa.
        </p>

        {loading ? (
          <div className="mt-5 rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-500">Preparando ingredientes…</div>
        ) : (
          <div className="mt-5 space-y-3">
            {items.length === 0 && (
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-500">Esta receta no tiene ingredientes registrados.</div>
            )}
            {items.map((item, index) => {
              const exact = item.pantry?.quantity !== null && item.pantry?.quantity !== undefined && item.pantry?.unit
              const converted = exact ? compatible(Number(item.quantity || 0), item.unit, item.pantry!.unit!) : null
              const canDeduct = converted !== null && converted !== undefined
              return (
                <div key={item.ingredientId} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_110px] sm:items-end">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">{item.name}</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {!item.pantry
                          ? 'No está en despensa'
                          : exact
                            ? `Despensa: ${formatNumber(Number(item.pantry.quantity))} ${item.pantry.unit}`
                            : `Despensa: ${item.pantry.status === 'queda_poco' ? 'Queda poco' : item.pantry.status === 'no_tengo' ? 'No tengo' : 'Tengo'}`}
                      </p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Cantidad usada</label>
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={item.quantity}
                        onChange={(event) => {
                          const next = [...items]
                          next[index] = { ...next[index], quantity: event.target.value }
                          setItems(next)
                        }}
                        className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Unidad</label>
                      <select
                        value={item.unit}
                        onChange={(event) => {
                          const next = [...items]
                          next[index] = { ...next[index], unit: event.target.value as Unit }
                          setItems(next)
                        }}
                        className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-400"
                      >
                        {units.map((unit) => <option key={unit}>{unit}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className={`mt-3 flex items-center gap-2 text-xs ${canDeduct ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {canDeduct ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    {canDeduct ? 'Se descontará automáticamente de la despensa.' : 'No se descontará automáticamente; revisa la despensa manualmente.'}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {warnings > 0 && !loading && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {warnings} {warnings === 1 ? 'ingrediente necesita' : 'ingredientes necesitan'} revisión manual de despensa.
          </div>
        )}

        {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button disabled={saving} onClick={onClose} className="rounded-2xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            Cancelar
          </button>
          <button disabled={loading || saving} onClick={() => void confirm()} className="rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
            {saving ? 'Confirmando…' : 'Confirmar y descontar'}
          </button>
        </div>
      </div>
    </div>
  )
}
