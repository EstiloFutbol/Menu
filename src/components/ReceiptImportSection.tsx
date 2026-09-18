import { Camera, CheckCircle2, LoaderCircle, Plus, ReceiptText, RotateCcw, Trash2 } from 'lucide-react'
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { createWorker } from 'tesseract.js'
import { extractReceiptDate, extractReceiptTotal, guessStoreName, normalizeDecimalInput, normalizeReceiptName, parseDecimalInput, parseReceiptText, scoreReceiptText } from '../lib/receipt'
import { buildReceiptImageVariants } from '../lib/receipt-image'
import { supabase } from '../lib/supabase'

const units = ['g', 'kg', 'ml', 'l', 'unidad', 'cucharada', 'cucharadita', 'taza', 'lata', 'paquete'] as const
const categories = ['Fruta y verdura', 'Carne', 'Pescado y marisco', 'Lácteos y huevos', 'Panadería', 'Despensa', 'Congelados', 'Bebidas', 'Salsas y condimentos', 'Otros'] as const

type Unit = (typeof units)[number]
type Ingredient = { id: string; name: string; category: string | null; default_unit: Unit | null }
type Alias = { normalized_name: string; ingredient_id: string; ingredient: Ingredient | null }
type PantryItem = { ingredient_id: string; quantity: number | null; unit: Unit | null; status: string | null }

type ReviewLine = {
  id: string
  rawName: string
  translatedName: string
  ingredientId: string
  category: string
  quantity: string
  unit: Unit
  totalPrice: string
  include: boolean
  addToPantry: boolean
  matchedByAlias: boolean
}

function localDatetimeValue(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function lineId(index: number) {
  return `receipt-line-${Date.now()}-${index}`
}

function compatibleQuantity(quantity: number, from: Unit, to: Unit) {
  if (from === to) return quantity
  if (from === 'g' && to === 'kg') return quantity / 1000
  if (from === 'kg' && to === 'g') return quantity * 1000
  if (from === 'ml' && to === 'l') return quantity / 1000
  if (from === 'l' && to === 'ml') return quantity * 1000
  return null
}

export default function ReceiptImportSection() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])
  const [pantry, setPantry] = useState<PantryItem[]>([])
  const [lines, setLines] = useState<ReviewLine[]>([])
  const [storeName, setStoreName] = useState('')
  const [purchasedAt, setPurchasedAt] = useState(localDatetimeValue())
  const [totalAmount, setTotalAmount] = useState('')
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadReferenceData = useCallback(async () => {
    if (!supabase) return
    const [ingredientsResult, aliasesResult, pantryResult] = await Promise.all([
      supabase.from('ingredients').select('id,name,category,default_unit').order('name'),
      supabase.from('receipt_aliases').select('normalized_name,ingredient_id,ingredient:ingredients(id,name,category,default_unit)'),
      supabase.from('pantry_items').select('ingredient_id,quantity,unit,status'),
    ])
    if (ingredientsResult.error || aliasesResult.error || pantryResult.error) {
      setError(ingredientsResult.error?.message ?? aliasesResult.error?.message ?? pantryResult.error?.message ?? 'No se pudo preparar la importación.')
      return
    }
    setIngredients((ingredientsResult.data ?? []) as Ingredient[])
    setAliases((aliasesResult.data ?? []) as unknown as Alias[])
    setPantry((pantryResult.data ?? []) as PantryItem[])
  }, [])

  useEffect(() => { void loadReferenceData() }, [loadReferenceData])

  const ingredientsByNormalized = useMemo(() => {
    const map = new Map<string, Ingredient>()
    ingredients.forEach((ingredient) => map.set(normalizeReceiptName(ingredient.name), ingredient))
    return map
  }, [ingredients])

  const aliasesByNormalized = useMemo(() => {
    const map = new Map<string, Alias>()
    aliases.forEach((alias) => map.set(alias.normalized_name, alias))
    return map
  }, [aliases])

  const pantryByIngredient = useMemo(() => {
    const map = new Map<string, PantryItem>()
    pantry.forEach((item) => map.set(item.ingredient_id, item))
    return map
  }, [pantry])

  function buildReviewLines(text: string) {
    const parsed = parseReceiptText(text)
    return parsed.map((item, index): ReviewLine => {
      const normalized = normalizeReceiptName(item.rawName)
      const alias = aliasesByNormalized.get(normalized)
      const directIngredient = ingredientsByNormalized.get(normalized)
      const ingredient = alias?.ingredient ?? directIngredient ?? null
      const defaultUnit = ingredient?.default_unit ?? 'unidad'
      return {
        id: lineId(index),
        rawName: item.rawName,
        translatedName: ingredient?.name ?? item.rawName,
        ingredientId: ingredient?.id ?? '',
        category: ingredient?.category ?? 'Otros',
        quantity: String(defaultUnit === 'unidad' && item.packages ? item.packages : 1),
        unit: defaultUnit,
        totalPrice: item.totalPrice == null ? '' : String(item.totalPrice),
        include: true,
        addToPantry: true,
        matchedByAlias: Boolean(alias),
      }
    })
  }

  async function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setSuccess('')
    setReading(true)
    setProgress('Preparando imagen…')
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null

    try {
      const variants = await buildReceiptImageVariants(file)
      worker = await createWorker('spa')
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
      } as never)

      let bestText = ''
      let bestScore = -Infinity

      for (let index = 0; index < variants.length; index += 1) {
        const variant = variants[index]
        setProgress(`Leyendo ticket… ${index + 1}/${variants.length}`)
        const result = await worker.recognize(variant.source)
        const candidateText = result.data.text
        const candidateScore = scoreReceiptText(candidateText, result.data.confidence)
        if (candidateScore > bestScore) {
          bestScore = candidateScore
          bestText = candidateText
        }
      }

      const text = bestText
      setLines(buildReviewLines(text))
      const total = extractReceiptTotal(text)
      const receiptDate = extractReceiptDate(text)
      const store = guessStoreName(text)
      if (total != null) setTotalAmount(String(total))
      if (receiptDate) setPurchasedAt(localDatetimeValue(receiptDate))
      if (store) setStoreName(store)
      setProgress('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo leer el ticket.')
      setProgress('')
    } finally {
      if (worker) await worker.terminate()
      setReading(false)
      event.target.value = ''
    }
  }

  function updateLine(id: string, patch: Partial<ReviewLine>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line))
  }

  function updateTranslatedName(line: ReviewLine, value: string) {
    const ingredient = ingredientsByNormalized.get(normalizeReceiptName(value))
    updateLine(line.id, {
      translatedName: value,
      ingredientId: ingredient?.id ?? '',
      category: ingredient?.category ?? line.category,
      unit: ingredient?.default_unit ?? line.unit,
      matchedByAlias: false,
    })
  }

  function addManualLine() {
    setLines((current) => [...current, {
      id: lineId(current.length),
      rawName: '',
      translatedName: '',
      ingredientId: '',
      category: 'Otros',
      quantity: '1',
      unit: 'unidad',
      totalPrice: '',
      include: true,
      addToPantry: true,
      matchedByAlias: false,
    }])
  }

  function reset() {
    setLines([])
    setStoreName('')
    setPurchasedAt(localDatetimeValue())
    setTotalAmount('')
    setError('')
    setSuccess('')
    setProgress('')
  }

  const selectedLines = lines.filter((line) => line.include)
  const detectedTotal = selectedLines.reduce((sum, line) => sum + (parseDecimalInput(line.totalPrice) ?? 0), 0)

  function pantryHint(line: ReviewLine) {
    if (!line.ingredientId || !line.addToPantry) return null
    const current = pantryByIngredient.get(line.ingredientId)
    if (!current) return 'Se creará en despensa con esta cantidad.'
    if (current.quantity == null) return 'Ahora se controla por estado: se marcará como “Tengo”.'
    const quantity = parseDecimalInput(line.quantity)
    if (quantity == null) return 'Cantidad inválida.'
    const converted = compatibleQuantity(quantity, line.unit, current.unit ?? line.unit)
    if (converted == null) return 'Unidad incompatible con la despensa actual. Cámbiala antes de importar.'
    return `Se sumará a ${current.quantity} ${current.unit ?? ''} existentes.`
  }

  async function importReceipt() {
    if (!supabase) return
    setError('')
    setSuccess('')
    if (!storeName.trim()) { setError('Revisa el nombre de la tienda.'); return }
    const parsedTotalAmount = parseDecimalInput(totalAmount)
    if (parsedTotalAmount == null || parsedTotalAmount < 0) { setError('Revisa el total del ticket.'); return }
    if (!selectedLines.length) { setError('Selecciona al menos un producto.'); return }

    for (const line of selectedLines) {
      if (!line.rawName.trim() || !line.translatedName.trim()) { setError('Todos los productos seleccionados necesitan concepto y traducción.'); return }
      const parsedQuantity = parseDecimalInput(line.quantity)
      const parsedLinePrice = line.totalPrice ? parseDecimalInput(line.totalPrice) : 0
      if (parsedQuantity == null || parsedQuantity <= 0) { setError(`Revisa la cantidad de ${line.translatedName || line.rawName}.`); return }
      if (parsedLinePrice == null || parsedLinePrice < 0) { setError(`Revisa el precio de ${line.translatedName || line.rawName}.`); return }
      const hint = pantryHint(line)
      if (line.addToPantry && hint?.startsWith('Unidad incompatible')) { setError(`${line.translatedName}: ${hint}`); return }
    }

    setSaving(true)
    const payload = selectedLines.map((line) => ({
      raw_name: line.rawName.trim(),
      canonical_name: line.translatedName.trim(),
      normalized_name: normalizeReceiptName(line.rawName),
      ingredient_id: line.ingredientId || null,
      category: line.category,
      quantity: parseDecimalInput(line.quantity)!,
      unit: line.unit,
      total_price: line.totalPrice ? parseDecimalInput(line.totalPrice)! : 0,
      add_to_pantry: line.addToPantry,
    }))

    const { error: importError } = await supabase.rpc('import_reviewed_receipt', {
      p_store_name: storeName.trim(),
      p_purchased_at: new Date(purchasedAt).toISOString(),
      p_total_amount: parsedTotalAmount,
      p_items: payload,
    })
    setSaving(false)

    if (importError) { setError(importError.message); return }
    setSuccess(`Ticket importado. ${selectedLines.filter((line) => line.addToPantry).length} productos actualizados en la despensa.`)
    await loadReferenceData()
  }

  if (!lines.length && !reading) {
    return <div className="space-y-5">
      {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-neutral-100"><ReceiptText size={25} /></div>
          <h2 className="mt-4 text-xl font-semibold">Importar ticket</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">Haz una foto o elige una imagen. El ticket se procesa localmente en tu navegador y la imagen se descarta al terminar el OCR. Después podrás revisar cada producto antes de guardar nada.</p>
          <label className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white">
            <Camera size={18} /> Hacer foto o elegir ticket
            <input type="file" accept="image/*" capture="environment" onChange={handleImage} className="hidden" />
          </label>
          <div className="mt-5 grid gap-2 text-left text-xs text-neutral-500 sm:grid-cols-3">
            <div className="rounded-2xl bg-neutral-50 p-3"><span className="font-semibold text-neutral-700">1. Leer</span><p className="mt-1">Extrae los conceptos y precios visibles.</p></div>
            <div className="rounded-2xl bg-neutral-50 p-3"><span className="font-semibold text-neutral-700">2. Traducir</span><p className="mt-1">Corrige abreviaturas y asocia alimentos.</p></div>
            <div className="rounded-2xl bg-neutral-50 p-3"><span className="font-semibold text-neutral-700">3. Confirmar</span><p className="mt-1">Revisa cantidades y decide qué entra en despensa.</p></div>
          </div>
        </div>
      </section>
    </div>
  }

  if (reading) {
    return <div className="rounded-3xl border border-neutral-200 bg-white p-10 text-center shadow-sm">
      <LoaderCircle className="mx-auto animate-spin text-neutral-500" size={30} />
      <h2 className="mt-4 font-semibold">Leyendo el ticket</h2>
      <p className="mt-2 text-sm text-neutral-500">{progress || 'Procesando imagen…'}</p>
      <p className="mt-1 text-xs text-neutral-400">Probamos varias versiones de la imagen y elegimos automáticamente la lectura más fiable.</p>
    </div>
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm font-medium text-neutral-500">Ticket leído</p><h2 className="mt-1 text-2xl font-semibold">Revisar antes de importar</h2><p className="mt-1 text-sm text-neutral-500">Corrige todo lo que necesites. Nada se guarda hasta confirmar.</p></div>
      <button onClick={reset} className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-600"><RotateCcw size={16} /> Otro ticket</button>
    </div>

    {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>}

    <section className="grid gap-4 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm sm:grid-cols-3">
      <label className="text-sm font-medium text-neutral-700">Tienda<input value={storeName} onChange={(e) => setStoreName(e.target.value)} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label>
      <label className="text-sm font-medium text-neutral-700">Fecha y hora<input type="datetime-local" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label>
      <label className="text-sm font-medium text-neutral-700">Total del ticket<input type="text" inputMode="decimal" value={totalAmount} onChange={(e) => setTotalAmount(normalizeDecimalInput(e.target.value))} className="mt-2 w-full rounded-2xl border border-neutral-200 px-4 py-3 font-normal" /></label>
      <div className="sm:col-span-3 flex flex-wrap gap-x-5 gap-y-1 rounded-2xl bg-neutral-50 px-4 py-3 text-xs text-neutral-500"><span>{selectedLines.length} líneas seleccionadas</span><span>Suma de líneas detectadas: {detectedTotal.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</span><span>El total del ticket siempre se puede corregir manualmente.</span></div>
    </section>

    <datalist id="receipt-ingredients">{ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.name} />)}</datalist>

    <div className="space-y-3">
      {lines.map((line, index) => {
        const hint = pantryHint(line)
        return <article key={line.id} className={`rounded-3xl border bg-white p-4 shadow-sm sm:p-5 ${line.include ? 'border-neutral-200' : 'border-neutral-100 opacity-60'}`}>
          <div className="flex items-start gap-3">
            <input type="checkbox" checked={line.include} onChange={(e) => updateLine(line.id, { include: e.target.checked })} className="mt-1 h-4 w-4" aria-label="Incluir producto" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Línea {index + 1}</span>{line.matchedByAlias && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Traducción recordada</span>}</div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_110px_120px_120px]">
                <label className="text-xs font-medium text-neutral-500">Concepto del ticket<input value={line.rawName} onChange={(e) => updateLine(line.id, { rawName: e.target.value, matchedByAlias: false })} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-normal text-neutral-800" /></label>
                <label className="text-xs font-medium text-neutral-500">Qué es realmente<input list="receipt-ingredients" value={line.translatedName} onChange={(e) => updateTranslatedName(line, e.target.value)} placeholder="Ej. Pechuga de pavo" className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-normal text-neutral-800" /></label>
                <label className="text-xs font-medium text-neutral-500">Cantidad<input type="text" inputMode="decimal" value={line.quantity} onChange={(e) => updateLine(line.id, { quantity: normalizeDecimalInput(e.target.value) })} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-normal" /></label>
                <label className="text-xs font-medium text-neutral-500">Unidad<select value={line.unit} onChange={(e) => updateLine(line.id, { unit: e.target.value as Unit })} className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-normal">{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
                <label className="text-xs font-medium text-neutral-500">Precio línea<input type="text" inputMode="decimal" value={line.totalPrice} onChange={(e) => updateLine(line.id, { totalPrice: normalizeDecimalInput(e.target.value) })} className="mt-1.5 w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-normal" /></label>
              </div>
              {!line.ingredientId && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-neutral-500">Categoría del nuevo alimento<select value={line.category} onChange={(e) => updateLine(line.id, { category: e.target.value })} className="mt-1.5 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm font-normal">{categories.map((category) => <option key={category}>{category}</option>)}</select></label><div className="flex items-end"><p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800">No coincide con un alimento existente. Al importar se creará “{line.translatedName || '…'}”.</p></div></div>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3">
                <label className="flex items-center gap-2 text-xs font-medium text-neutral-700"><input type="checkbox" checked={line.addToPantry} onChange={(e) => updateLine(line.id, { addToPantry: e.target.checked })} /> Añadir a despensa</label>
                {hint && <p className={`text-xs ${hint.startsWith('Unidad incompatible') ? 'text-red-600' : 'text-neutral-400'}`}>{hint}</p>}
                <button onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))} className="flex items-center gap-1 text-xs font-medium text-red-500"><Trash2 size={14} /> Quitar línea</button>
              </div>
            </div>
          </div>
        </article>
      })}
    </div>

    <button onClick={addManualLine} className="flex items-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-white px-4 py-3 text-sm font-medium text-neutral-600"><Plus size={17} /> Añadir línea manual</button>

    <div className="sticky bottom-4 z-10 flex flex-col gap-3 rounded-3xl border border-neutral-200 bg-white/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-sm font-semibold">{selectedLines.filter((line) => line.addToPantry).length} productos irán a despensa</p><p className="mt-0.5 text-xs text-neutral-500">Las equivalencias corregidas se recordarán para próximos tickets.</p></div>
      <button disabled={saving || !selectedLines.length} onClick={() => void importReceipt()} className="flex items-center justify-center gap-2 rounded-2xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? <><LoaderCircle className="animate-spin" size={17} /> Guardando…</> : <><CheckCircle2 size={17} /> Confirmar e importar</>}</button>
    </div>
  </div>
}
