import { Check, ChevronDown, Plus, Search } from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { rankBySearch } from '../lib/search'

// hint: aclaración a la derecha. Si la opción tiene grupo, solo se ve al buscar (sin buscar ya lo dice el grupo).
export type SearchOption = { value: string; label: string; hint?: string; group?: string }

// Desplegable con buscador (lupa) para elegir una receta o un producto entre muchos.
// Se puede escribir para filtrar (sin importar tildes ni mayúsculas) y moverse con las flechas.
export function SearchSelect({ value, options, onChange, label, placeholder = 'Seleccionar…', searchPlaceholder = 'Buscar…', disabled = false, createLabel, onCreate }: {
  value: string
  options: SearchOption[]
  onChange: (value: string) => void
  label: string
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  // Acción al final de la lista, por ejemplo «+ Crear producto nuevo…». Recibe lo buscado.
  createLabel?: string
  onCreate?: (query: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()
  const selected = options.find((option) => option.value === value)

  const filtered = useMemo(() => rankBySearch(options, query, (option) => option.label), [options, query])
  // Con búsqueda se ordena por relevancia; sin ella, se respetan los grupos.
  const rows = useMemo(() => {
    const result: Array<{ kind: 'group'; label: string } | { kind: 'option'; option: SearchOption; index: number }> = []
    let lastGroup: string | undefined
    filtered.forEach((option, index) => {
      if (!query.trim() && option.group && option.group !== lastGroup) result.push({ kind: 'group', label: option.group })
      lastGroup = option.group
      result.push({ kind: 'option', option, index })
    })
    return result
  }, [filtered, query])
  const total = filtered.length + (onCreate ? 1 : 0)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | TouchEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('touchstart', close) }
  }, [open])

  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active])

  function show() {
    if (disabled) return
    setQuery('')
    setActive(Math.max(0, options.findIndex((option) => option.value === value)))
    setOpen(true)
  }

  function choose(index: number) {
    if (index < filtered.length) onChange(filtered[index].value)
    else onCreate?.(query.trim())
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((current) => Math.min(total - 1, current + 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((current) => Math.max(0, current - 1)) }
    else if (event.key === 'Enter') { event.preventDefault(); if (total) choose(Math.min(active, total - 1)) }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
  }

  return <div ref={root} className="relative">
    <button type="button" disabled={disabled} onClick={() => (open ? setOpen(false) : show())} aria-label={label} aria-haspopup="listbox" aria-expanded={open}
      className="flex w-full items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-left text-sm disabled:bg-transparent">
      <span className={`min-w-0 truncate ${selected ? 'text-neutral-900' : 'text-neutral-400'}`}>{selected?.label ?? placeholder}</span>
      {!disabled && <ChevronDown size={15} className="shrink-0 text-neutral-400" />}
    </button>
    {open && <div className="absolute left-0 z-30 mt-1 w-full min-w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg">
      <div className="relative border-b border-neutral-100 p-2">
        <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input autoFocus type="search" role="combobox" aria-controls={listId} aria-expanded aria-label={`Buscar: ${label}`} value={query} placeholder={searchPlaceholder}
          onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={onKeyDown}
          className="w-full rounded-lg bg-neutral-50 py-2 pl-8 pr-3 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-neutral-300" />
      </div>
      <ul ref={list} id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto p-1">
        {rows.map((row) => row.kind === 'group'
          ? <li key={`g-${row.label}`} role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400">{row.label}</li>
          : <li key={row.option.value} role="option" aria-selected={row.option.value === value} data-active={row.index === active}
              onMouseEnter={() => setActive(row.index)} onClick={() => choose(row.index)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${row.index === active ? 'bg-neutral-100' : ''}`}>
              <span className="min-w-0 flex-1 truncate">{row.option.label}</span>
              {row.option.hint && (query.trim() || !row.option.group) && <span className="shrink-0 text-xs text-neutral-400">{row.option.hint}</span>}
              {row.option.value === value && <Check size={14} className="shrink-0 text-neutral-500" />}
            </li>)}
        {!filtered.length && <li role="presentation" className="px-3 py-3 text-sm text-neutral-400">No hay nada que se llame así.</li>}
        {onCreate && <li role="option" aria-selected={false} data-active={active === filtered.length} onMouseEnter={() => setActive(filtered.length)} onClick={() => choose(filtered.length)}
          className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 ${active === filtered.length ? 'bg-neutral-100' : ''}`}>
          <Plus size={15} /> {query.trim() ? `${createLabel ?? 'Crear'} «${query.trim()}»` : `${createLabel ?? 'Crear'}…`}
        </li>}
      </ul>
    </div>}
  </div>
}
