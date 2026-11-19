import { useEffect, useMemo, useState } from 'react'
import { friendlyError } from '../lib/errors'
import { aliasConcept, filterAliases, normalizeSearch, sortAliases, type ReceiptAlias } from '../lib/receipt-aliases'
import { supabase } from '../lib/supabase'

type Product = { id: string; name: string }

const PAGE = 50
const inputClass = 'w-full rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-neutral-900'
const buttonClass = 'rounded-2xl border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50'

function ReceiptAliasesCard() {
  const [aliases, setAliases] = useState<ReceiptAlias[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      if (!supabase) { setLoading(false); return }
      const [aliasResult, productResult] = await Promise.all([
        supabase.from('receipt_aliases').select('id,raw_name,normalized_name,ingredient_id,ingredient:ingredients(id,name)'),
        supabase.from('ingredients').select('id,name').order('name'),
      ])
      if (!active) return
      const failure = aliasResult.error ?? productResult.error
      if (failure) setError(friendlyError(failure, 'No se han podido cargar las traducciones.'))
      else {
        setAliases(sortAliases((aliasResult.data ?? []) as unknown as ReceiptAlias[]))
        setProducts((productResult.data ?? []) as Product[])
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [])

  const filtered = useMemo(() => filterAliases(aliases, query), [aliases, query])
  const shown = filtered.slice(0, visible)

  function startEdit(alias: ReceiptAlias) {
    setEditingId(alias.id)
    setDraft(alias.ingredient?.name ?? '')
    setError(null)
  }

  async function saveEdit(alias: ReceiptAlias) {
    if (!supabase) return
    const wanted = normalizeSearch(draft)
    const product = products.find((item) => item.name === draft.trim()) ?? products.find((item) => normalizeSearch(item.name) === wanted)
    if (!product) { setError('Ese producto no existe en el catálogo. Elige uno de la lista.'); return }
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase.from('receipt_aliases').update({ ingredient_id: product.id }).eq('id', alias.id)
    setBusy(false)
    if (updateError) { setError(friendlyError(updateError, 'No se ha podido cambiar la traducción.')); return }
    setAliases((current) => current.map((item) => item.id === alias.id ? { ...item, ingredient_id: product.id, ingredient: product } : item))
    setEditingId(null)
  }

  async function remove(alias: ReceiptAlias) {
    if (!supabase) return
    if (!window.confirm(`¿Borrar la traducción «${aliasConcept(alias)}»? La próxima vez que salga en un ticket, la app volverá a preguntar.`)) return
    setBusy(true)
    setError(null)
    const { error: deleteError } = await supabase.from('receipt_aliases').delete().eq('id', alias.id)
    setBusy(false)
    if (deleteError) { setError(friendlyError(deleteError, 'No se ha podido borrar la traducción.')); return }
    setAliases((current) => current.filter((item) => item.id !== alias.id))
    if (editingId === alias.id) setEditingId(null)
  }

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold">Traducciones de tickets</h2>
      <p className="mt-2 text-sm text-neutral-500">Cómo se traduce cada concepto del ticket a un producto del catálogo.</p>
      <datalist id="receipt-alias-products">{products.map((product) => <option key={product.id} value={product.name} />)}</datalist>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {loading ? <p className="mt-3 text-sm text-neutral-500">Cargando…</p> : aliases.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">Aún no hay traducciones. Se crean al confirmar productos al importar un ticket.</p>
      ) : (
        <>
          <input type="search" aria-label="Buscar traducciones" placeholder="Buscar por concepto o producto" value={query} onChange={(e) => { setQuery(e.target.value); setVisible(PAGE) }} className={`${inputClass} mt-3`} />
          <p className="mt-2 text-xs text-neutral-400">{query.trim() ? `${filtered.length} de ${aliases.length} traducciones` : `${aliases.length} traducciones`}</p>
          {filtered.length === 0 && <p className="mt-3 text-sm text-neutral-500">Sin resultados.</p>}
          <ul className="mt-2 divide-y divide-neutral-100">
            {shown.map((alias) => (
              <li key={alias.id} className="py-3">
                <p className="text-sm font-medium text-neutral-900">{aliasConcept(alias)}</p>
                {editingId === alias.id ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input list="receipt-alias-products" aria-label="Producto" value={draft} onChange={(e) => setDraft(e.target.value)} className={`${inputClass} flex-1`} />
                    <button type="button" disabled={busy} onClick={() => saveEdit(alias)} className="rounded-2xl bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Guardar</button>
                    <button type="button" disabled={busy} onClick={() => { setEditingId(null); setError(null) }} className={buttonClass}>Cancelar</button>
                  </div>
                ) : (
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-neutral-600">→ {alias.ingredient?.name ?? 'Producto desconocido'}</p>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => startEdit(alias)} className={buttonClass}>Cambiar producto</button>
                      <button type="button" disabled={busy} onClick={() => remove(alias)} className={`${buttonClass} text-red-600`}>Borrar</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {filtered.length > visible && <button type="button" onClick={() => setVisible((n) => n + PAGE)} className={`${buttonClass} mt-3`}>Ver más</button>}
        </>
      )}
    </section>
  )
}

export default ReceiptAliasesCard
