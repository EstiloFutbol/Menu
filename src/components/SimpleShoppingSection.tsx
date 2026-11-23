import { useCallback, useEffect, useState } from 'react'
import { formatQuantity, formatWeekRange, localDateString, startOfWeek } from '../lib/domain'
import { useRefreshOnReturn } from '../lib/refresh'
import { useSettings } from '../lib/settings'
import { supabase } from '../lib/supabase'
import { QuickList } from './QuickList'

type FullListItem = { id: string; manual_name: string | null; quantity: number | null; unit: string | null; checked: boolean; ingredient: { name: string } | null }

// Compra en modo sencillo: la lista escrita a mano. Debajo, sin poder editarla, la
// lista de la compra del modo completo de esta semana, si la hay.
export default function SimpleShoppingSection() {
  const { weekStartsOn } = useSettings().settings
  const weekStart = startOfWeek(new Date(), weekStartsOn)
  const weekKey = localDateString(weekStart)
  const [fullList, setFullList] = useState<FullListItem[]>([])

  const loadFullList = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('shopping_lists').select('shopping_items(id,manual_name,quantity,unit,checked,sort_order,ingredient:ingredients(name))').eq('week_start', weekKey).maybeSingle()
    const items = ((data as { shopping_items?: Array<FullListItem & { sort_order: number }> } | null)?.shopping_items ?? []).sort((a, b) => a.sort_order - b.sort_order)
    setFullList(items)
  }, [weekKey])
  useEffect(() => { void loadFullList() }, [loadFullList])
  useRefreshOnReturn(loadFullList)

  return <div className="mx-auto max-w-2xl space-y-5">
    <header>
      <p className="text-sm font-medium text-neutral-500">Compra</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-neutral-950">Lista de la compra</h1>
      <p className="mt-2 text-sm text-neutral-500">Escribe lo que haga falta y márcalo al comprarlo. Todos en el hogar ven la misma lista.</p>
    </header>
    <QuickList editable />
    {fullList.length > 0 && <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-neutral-700">En la lista completa</h2>
      <p className="text-xs text-neutral-400">Semana {formatWeekRange(weekStart)}. Se cambia en el modo completo.</p>
      <ul className="mt-3 space-y-1 text-sm">
        {fullList.map((item) => <li key={item.id} className={item.checked ? 'text-neutral-400 line-through' : 'text-neutral-700'}>
          {item.ingredient?.name ?? item.manual_name}{item.quantity != null && item.unit ? <span className="text-neutral-400"> · {formatQuantity(Number(item.quantity))} {item.unit}</span> : null}
        </li>)}
      </ul>
    </section>}
  </div>
}
