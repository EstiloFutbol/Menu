import { ChevronDown, ChevronUp, MapPin, ReceiptText, Store } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type PurchaseItem = {
  id: string
  raw_name: string
  quantity: number | null
  unit: string | null
  packages: number | null
  package_unit_price: number | null
  price_before_discount: number
  discount_amount: number
  total_price: number
  reference_unit_price: number | null
  reference_unit: string | null
  notes: string | null
  ingredient: { id: string; name: string } | null
}

type Purchase = {
  id: string
  purchased_at: string
  store_name: string
  store_address: string | null
  total_amount: number
  discount_total: number
  currency: string
  receipt_number: string | null
  payment_method: string | null
  notes: string | null
  purchase_items: PurchaseItem[]
}

function money(value: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value)
}

function quantityLabel(item: PurchaseItem) {
  if (item.quantity != null && item.unit) {
    return `${Number(item.quantity).toLocaleString('es-ES', { maximumFractionDigits: 3 })} ${item.unit}`
  }
  if (item.packages != null) {
    return `${Number(item.packages).toLocaleString('es-ES')} ${Number(item.packages) === 1 ? 'unidad' : 'unidades'}`
  }
  return null
}

export default function PurchaseHistorySection() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openPurchase, setOpenPurchase] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setError('')

    const { data, error: queryError } = await supabase
      .from('purchases')
      .select(`
        id,
        purchased_at,
        store_name,
        store_address,
        total_amount,
        discount_total,
        currency,
        receipt_number,
        payment_method,
        notes,
        purchase_items (
          id,
          raw_name,
          quantity,
          unit,
          packages,
          package_unit_price,
          price_before_discount,
          discount_amount,
          total_price,
          reference_unit_price,
          reference_unit,
          notes,
          ingredient:ingredients(id,name)
        )
      `)
      .order('purchased_at', { ascending: false })

    if (queryError) setError(queryError.message)
    else setPurchases((data ?? []) as unknown as Purchase[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => {
    const spent = purchases.reduce((sum, purchase) => sum + Number(purchase.total_amount), 0)
    return {
      count: purchases.length,
      spent,
      average: purchases.length ? spent / purchases.length : 0,
    }
  }, [purchases])

  if (loading) {
    return <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-sm text-neutral-500 shadow-sm">Cargando historial…</div>
  }

  return (
    <div className="space-y-5">
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-neutral-500">Tickets</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-950">{totals.count}</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-neutral-500">Gasto registrado</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-950">{money(totals.spent)}</p>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-neutral-500">Ticket medio</p>
          <p className="mt-1 text-2xl font-semibold text-neutral-950">{money(totals.average)}</p>
        </div>
      </div>

      {purchases.length === 0 ? (
        <div className="rounded-3xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <ReceiptText className="mx-auto text-neutral-300" size={28} />
          <p className="mt-3 text-sm font-medium text-neutral-800">Todavía no hay compras registradas.</p>
          <p className="mt-1 text-sm text-neutral-500">Aquí aparecerán los tickets y precios históricos.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {purchases.map((purchase) => {
            const open = openPurchase === purchase.id
            const date = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(purchase.purchased_at))
            const items = purchase.purchase_items?.slice().sort((a, b) => a.raw_name.localeCompare(b.raw_name, 'es')) ?? []

            return (
              <section key={purchase.id} className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => setOpenPurchase(open ? null : purchase.id)}
                  className="flex w-full items-center justify-between gap-4 p-5 text-left hover:bg-neutral-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Store size={17} className="text-neutral-400" />
                      <h3 className="truncate font-semibold text-neutral-950">{purchase.store_name}</h3>
                    </div>
                    <p className="mt-1 text-sm text-neutral-500">{date} · {items.length} productos</p>
                    {purchase.store_address && (
                      <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-neutral-400"><MapPin size={12} /> {purchase.store_address}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="text-lg font-semibold text-neutral-950">{money(Number(purchase.total_amount))}</p>
                      {Number(purchase.discount_total) > 0 && <p className="text-xs text-emerald-700">-{money(Number(purchase.discount_total))} dto.</p>}
                    </div>
                    {open ? <ChevronUp size={18} className="text-neutral-400" /> : <ChevronDown size={18} className="text-neutral-400" />}
                  </div>
                </button>

                {open && (
                  <div className="border-t border-neutral-100 px-5 pb-5">
                    <div className="divide-y divide-neutral-100">
                      {items.map((item) => (
                        <div key={item.id} className="flex items-start justify-between gap-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-800">{item.ingredient?.name ?? item.raw_name}</p>
                            <p className="mt-0.5 text-xs text-neutral-400">{item.raw_name}</p>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-500">
                              {quantityLabel(item) && <span>{quantityLabel(item)}</span>}
                              {item.reference_unit_price != null && item.reference_unit && (
                                <span>{money(Number(item.reference_unit_price))}/{item.reference_unit}</span>
                              )}
                              {item.package_unit_price != null && Number(item.packages ?? 1) > 1 && (
                                <span>{Number(item.packages)} × {money(Number(item.package_unit_price))}</span>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-neutral-900">{money(Number(item.total_price))}</p>
                            {Number(item.discount_amount) > 0 && <p className="text-xs text-emerald-700">Dto. {money(Number(item.discount_amount))}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                    {(purchase.payment_method || purchase.receipt_number) && (
                      <div className="mt-3 rounded-2xl bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
                        {purchase.payment_method && <p>Pago: {purchase.payment_method}</p>}
                        {purchase.receipt_number && <p>Ticket: {purchase.receipt_number}</p>}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
