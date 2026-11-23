import { ArrowRight, ChevronDown, Languages, Pencil, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { friendlyError } from '../lib/errors'
import { aliasConcept, filterAliases, sortAliases, type ReceiptAlias } from '../lib/receipt-aliases'
import { supabase } from '../lib/supabase'
import { SearchSelect } from './SearchSelect'

type Product = { id: string; name: string }

const FIRST = 10
const MORE = 30

// Compra → Ticket: cómo se traduce cada concepto del ticket a un producto del catálogo.
// Plegado por defecto (una línea con el total); al abrirlo, buscador y una fila por traducción.
function ReceiptAliasesCard() {
  const [open, setOpen] = useState(false)
  const [aliases, setAliases] = useState<ReceiptAlias[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(FIRST)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    const [aliasResult, productResult] = await Promise.all([
      supabase.from('receipt_aliases').select('id,raw_name,normalized_name,ingredient_id,ingredient:ingredients(id,name)'),
      supabase.from('ingredients').select('id,name').order('name'),
    ])
    const failure = aliasResult.error ?? productResult.error
    if (failure) setError(friendlyError(failure, 'No se han podido cargar las traducciones.'))
    else {
      setAliases(sortAliases((aliasResult.data ?? []) as unknown as ReceiptAlias[]))
      setProducts((productResult.data ?? []) as Product[])
    }
    setLoaded(true)
  }, [])
  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => filterAliases(aliases, query), [aliases, query])
  const shown = filtered.slice(0, visible)
  const productOptions = useMemo(() => products.map((product) => ({ value: product.id, label: product.name })), [products])

  async function change(alias: ReceiptAlias, productId: string) {
    if (!supabase) return
    const product = products.find((item) => item.id === productId)
    if (!product) return
    setBusy(true); setError(null)
    const { error: updateError } = await supabase.from('receipt_aliases').update({ ingredient_id: product.id }).eq('id', alias.id)
    setBusy(false)
    if (updateError) { setError(friendlyError(updateError, 'No se ha podido cambiar la traducción.')); return }
    setAliases((current) => current.map((item) => item.id === alias.id ? { ...item, ingredient_id: product.id, ingredient: product } : item))
    setEditingId(null)
  }

  async function remove(alias: ReceiptAlias) {
    if (!supabase) return
    if (!window.confirm(`¿Borrar la traducción «${aliasConcept(alias)}»? La próxima vez que salga en un ticket, la app volverá a preguntar.`)) return
    setBusy(true); setError(null)
    const { error: deleteError } = await supabase.from('receipt_aliases').delete().eq('id', alias.id)
    setBusy(false)
    if (deleteError) { setError(friendlyError(deleteError, 'No se ha podido borrar la traducción.')); return }
    setAliases((current) => current.filter((item) => item.id !== alias.id))
    if (editingId === alias.id) setEditingId(null)
  }

  const count = aliases.length
  return (
    <section className="rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5">
        <Languages size={18} className="shrink-0 text-neutral-500" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-neutral-900">Traducciones de tickets</span>
          <span className="block text-xs text-neutral-500">{!loaded ? 'Cargando…' : count ? `${count} concepto${count === 1 ? '' : 's'} del ticket recordado${count === 1 ? '' : 's'} con su producto` : 'Se crean solas al confirmar productos de un ticket'}</span>
        </span>
        <ChevronDown size={17} className={`shrink-0 text-neutral-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-neutral-100 px-4 pb-4 pt-3 sm:px-5">
        {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
        {count === 0 ? <p className="text-sm text-neutral-500">Aún no hay traducciones. Cuando confirmes los productos de un ticket, la app recordará cada concepto para la próxima vez.</p> : <>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input type="search" aria-label="Buscar traducciones" placeholder="Buscar por concepto o producto" value={query} onChange={(e) => { setQuery(e.target.value); setVisible(FIRST) }} className="w-full rounded-xl border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-neutral-900" />
          </div>
          {query.trim() && <p className="mt-2 text-xs text-neutral-400">{filtered.length} de {count}</p>}
          {filtered.length === 0 && <p className="mt-3 text-sm text-neutral-500">Sin resultados.</p>}
          <ul className="mt-2 divide-y divide-neutral-100">
            {shown.map((alias) => <li key={alias.id} className="py-2">
              {editingId === alias.id ? <div className="flex items-center gap-2">
                <p className="w-1/3 min-w-0 truncate font-mono text-xs text-neutral-500" title={aliasConcept(alias)}>{aliasConcept(alias)}</p>
                <div className="min-w-0 flex-1"><SearchSelect label={`Producto para ${aliasConcept(alias)}`} value={alias.ingredient_id} options={productOptions} searchPlaceholder="Buscar producto" disabled={busy} onChange={(productId) => void change(alias, productId)} /></div>
                <button type="button" onClick={() => setEditingId(null)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100" aria-label="Cancelar"><X size={15} /></button>
              </div> : <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm" title={`${aliasConcept(alias)} → ${alias.ingredient?.name ?? ''}`}>
                  <span className="font-mono text-xs text-neutral-500">{aliasConcept(alias)}</span>
                  <ArrowRight size={12} className="mx-1.5 inline text-neutral-300" />
                  <span className="text-neutral-800">{alias.ingredient?.name ?? 'Producto desconocido'}</span>
                </p>
                <button type="button" disabled={busy} onClick={() => { setEditingId(alias.id); setError(null) }} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label={`Cambiar el producto de ${aliasConcept(alias)}`} title="Cambiar producto"><Pencil size={14} /></button>
                <button type="button" disabled={busy} onClick={() => void remove(alias)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-neutral-300 hover:bg-red-50 hover:text-red-500" aria-label={`Borrar la traducción ${aliasConcept(alias)}`} title="Borrar"><Trash2 size={14} /></button>
              </div>}
            </li>)}
          </ul>
          {filtered.length > visible && <button type="button" onClick={() => setVisible((n) => n + MORE)} className="mt-2 text-sm font-medium text-neutral-600 hover:text-neutral-900">Ver más ({filtered.length - visible})</button>}
        </>}
      </div>}
    </section>
  )
}

export default ReceiptAliasesCard
