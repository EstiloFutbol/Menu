import { ArrowDown, ArrowUp, Check, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useState } from 'react'
import { friendlyError } from '../lib/errors'
import { useRefreshOnReturn } from '../lib/refresh'
import { authorLabel, useHouseholdMembers } from '../lib/household'
import { moveItem, QUICK_ITEM_MAX, splitQuickItems } from '../lib/simple'
import { supabase } from '../lib/supabase'

export type QuickItem = { id: string; text: string; checked: boolean; position: number; created_by?: string | null }

// Lista de la compra escrita a mano (modo sencillo).
// * editable: añadir (varias líneas a la vez), marcar, ordenar, borrar y «Quitar lo comprado».
// * Si no es editable (modo completo) se muestra como bloque «Apuntado a mano», solo para
//   marcar lo comprado, y no aparece si está vacía.
export function QuickList({ editable }: { editable: boolean }) {
  const [items, setItems] = useState<QuickItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // En un hogar compartido se indica quién apuntó lo que no apuntaste tú.
  const members = useHouseholdMembers()
  const addedByOther = (item: QuickItem) => { const label = authorLabel(item.created_by, members); return label && label !== 'por ti' ? `apuntado ${label}` : null }

  const load = useCallback(async () => {
    if (!supabase) return
    const { data, error: loadError } = await supabase.from('quick_list_items').select('id,text,checked,position,created_by').order('position').order('created_at')
    if (loadError) {
      // Sin la migración del modo sencillo, el bloque del modo completo simplemente no aparece.
      if (editable) setError(/quick_list_items/.test(loadError.message) ? 'Falta aplicar en Supabase la migración 20261127000100_simple_mode.sql.' : friendlyError(loadError, 'No se pudo cargar la lista.'))
    } else setItems((data ?? []) as QuickItem[])
    setLoaded(true)
  }, [editable])
  useEffect(() => { void load() }, [load])
  useRefreshOnReturn(load)

  async function add(event?: FormEvent) {
    event?.preventDefault()
    if (!supabase) return
    const texts = splitQuickItems(input)
    if (!texts.length) return
    setBusy(true); setError('')
    const start = items.reduce((max, item) => Math.max(max, item.position), 0) + 1
    const { error: insertError } = await supabase.from('quick_list_items').insert(texts.map((text, index) => ({ text, position: start + index })))
    setBusy(false)
    if (insertError) { setError(friendlyError(insertError, 'No se pudo añadir.')); return }
    setInput('')
    await load()
  }

  // Intro añade; Mayúsculas + Intro hace otra línea. Pegar varias líneas añade varias cosas.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void add() }
  }

  async function toggle(item: QuickItem) {
    if (!supabase) return
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, checked: !item.checked } : candidate))
    const { error: updateError } = await supabase.from('quick_list_items').update({ checked: !item.checked }).eq('id', item.id)
    if (updateError) { setError(friendlyError(updateError, 'No se pudo marcar.')); await load() }
  }

  async function move(item: QuickItem, direction: -1 | 1) {
    if (!supabase) return
    const changes = moveItem(items, item.id, direction)
    if (!changes.length) return
    setItems((current) => current.map((candidate) => ({ ...candidate, position: changes.find((change) => change.id === candidate.id)?.position ?? candidate.position })).sort((a, b) => a.position - b.position))
    const results = await Promise.all(changes.map((change) => supabase!.from('quick_list_items').update({ position: change.position }).eq('id', change.id)))
    const failed = results.find((result) => result.error)
    if (failed?.error) { setError(friendlyError(failed.error, 'No se pudo mover.')); await load() }
  }

  async function remove(item: QuickItem) {
    if (!supabase) return
    setItems((current) => current.filter((candidate) => candidate.id !== item.id))
    const { error: deleteError } = await supabase.from('quick_list_items').delete().eq('id', item.id)
    if (deleteError) { setError(friendlyError(deleteError, 'No se pudo quitar.')); await load() }
  }

  async function clearChecked() {
    if (!supabase) return
    const checked = items.filter((item) => item.checked)
    if (!checked.length || !window.confirm(`¿Quitar de la lista ${checked.length === 1 ? 'lo que has marcado' : `las ${checked.length} cosas marcadas`} como comprado?`)) return
    const { error: deleteError } = await supabase.from('quick_list_items').delete().in('id', checked.map((item) => item.id))
    if (deleteError) { setError(friendlyError(deleteError, 'No se pudo quitar lo comprado.')); return }
    await load()
  }

  if (!editable && (!loaded || !items.length)) return null
  const checkedCount = items.filter((item) => item.checked).length

  return <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
    {!editable && <div className="border-b border-neutral-100 px-5 py-3"><h2 className="text-sm font-semibold text-neutral-700">Apuntado a mano</h2><p className="text-xs text-neutral-400">Lo escrito en la lista del modo sencillo.</p></div>}
    {editable && <form data-tour="lista-anadir" onSubmit={add} className="flex items-start gap-2 p-3 pb-2 sm:p-4 sm:pb-2">
      <textarea aria-label="Añadir a la lista" rows={1} value={input} maxLength={QUICK_ITEM_MAX * 50} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown} placeholder="Añadir a la lista" title="Una cosa por línea: puedes pegar varias a la vez" className="min-h-11 flex-1 resize-none rounded-2xl border border-neutral-200 px-4 py-2.5 text-sm outline-none focus:border-neutral-900" />
      <button type="submit" disabled={busy || !input.trim()} className="flex h-11 shrink-0 items-center gap-1.5 rounded-2xl bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-40"><Plus size={16} /> Añadir</button>
    </form>}
    {editable && <p className="border-b border-neutral-100 px-4 py-2 text-xs text-neutral-400 sm:px-5">Una cosa por línea. Puedes pegar una lista entera y se añade todo.</p>}
    {error && <p role="alert" className="px-5 pt-3 text-sm text-red-600">{error}</p>}
    {editable && loaded && !items.length && !error && <p className="px-5 py-8 text-center text-sm text-neutral-400">La lista está vacía. Escribe arriba lo que necesites comprar.</p>}
    <ul data-tour={items.length ? 'lista-items' : undefined} className="divide-y divide-neutral-100">
      {items.map((item, index) => <li key={item.id} className={`flex items-center gap-3 px-4 py-2.5 sm:px-5 ${item.checked ? 'bg-neutral-50' : ''}`}>
        <button type="button" onClick={() => void toggle(item)} className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border transition ${item.checked ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white'}`} aria-label={item.checked ? `Marcar ${item.text} como pendiente` : `Marcar ${item.text} como comprado`}>{item.checked && <Check size={15} />}</button>
        <p className={`min-w-0 flex-1 break-words text-sm ${item.checked ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>{item.text}{addedByOther(item) && <span className="ml-1.5 text-[11px] font-normal text-neutral-400 no-underline">· {addedByOther(item)}</span>}</p>
        {editable && <div className="flex shrink-0 items-center">
          <button type="button" disabled={index === 0} onClick={() => void move(item, -1)} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 disabled:opacity-25" aria-label={`Subir ${item.text}`}><ArrowUp size={15} /></button>
          <button type="button" disabled={index === items.length - 1} onClick={() => void move(item, 1)} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 disabled:opacity-25" aria-label={`Bajar ${item.text}`}><ArrowDown size={15} /></button>
          <button type="button" onClick={() => void remove(item)} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-300 hover:bg-red-50 hover:text-red-500" aria-label={`Quitar ${item.text}`}><Trash2 size={15} /></button>
        </div>}
      </li>)}
    </ul>
    {editable && checkedCount > 0 && <div className="border-t border-neutral-100 p-3 sm:px-5">
      <button type="button" onClick={() => void clearChecked()} className="rounded-2xl border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">Quitar lo comprado ({checkedCount})</button>
    </div>}
  </section>
}
