import { Camera, CheckCircle2, ChevronDown, FilePlus2, FileText, LoaderCircle, PackagePlus, Plus, ReceiptText, RotateCcw, Trash2 } from 'lucide-react'
import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { createWorker } from 'tesseract.js'
import { normalizeReceiptName, parseDecimalInput, scoreReceiptText, type ParsedReceiptLine } from '../lib/receipt'
import { readReceiptTexts } from '../lib/receipt-read'
import { numberToInputValue } from '../lib/numbers'
import { buildReceiptImageVariants } from '../lib/receipt-image'
import { convertCompatibleQuantity } from '../lib/domain'
import { friendlyError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { NumberInput } from './NumberInput'
import type { PantryNotice } from '../lib/pantry-notice'
import { setLeaveGuard } from '../lib/leave-guard'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import ReceiptAliasesCard from './ReceiptAliasesCard'

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

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

function lineId(index: number) {
  return `receipt-line-${Date.now()}-${index}`
}

// onImported: se llama tras importar un ticket que ha añadido productos a la despensa.
export default function ReceiptImportSection({ onImported }: { onImported?: (notice: PantryNotice) => void }) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])
  const [pantry, setPantry] = useState<PantryItem[]>([])
  const [lines, setLines] = useState<ReviewLine[]>([])
  const [storeName, setStoreName] = useState('')
  const [purchasedAt, setPurchasedAt] = useState(localDatetimeValue())
  const [totalAmount, setTotalAmount] = useState('')
  // Descuentos del ticket que no van ligados a un producto (p. ej. "Descuento mensual" de Consum).
  const [ticketDiscount, setTicketDiscount] = useState(0)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [sourceMode, setSourceMode] = useState<'ocr' | 'manual' | null>(null)
  // Texto que ha sacado el OCR o el PDF, para poder revisarlo o enviarlo si la lectura falla.
  const [readTexts, setReadTexts] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  // En el móvil cada producto se ve en una fila compacta y se despliega para editarlo.
  const isWide = useMediaQuery('(min-width: 1024px)')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadReferenceData = useCallback(async () => {
    if (!supabase) return
    const [ingredientsResult, aliasesResult, pantryResult] = await Promise.all([
      supabase.from('ingredients').select('id,name,category,default_unit').order('name'),
      supabase.from('receipt_aliases').select('normalized_name,ingredient_id,ingredient:ingredients(id,name,category,default_unit)'),
      supabase.from('pantry_items').select('ingredient_id,quantity,unit,status'),
    ])
    if (ingredientsResult.error || aliasesResult.error || pantryResult.error) {
      setError(friendlyError(ingredientsResult.error ?? aliasesResult.error ?? pantryResult.error, 'No se pudo preparar la importación.'))
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

  function buildReviewLines(parsed: ParsedReceiptLine[]) {
    return parsed.map((item, index): ReviewLine => {
      const normalized = normalizeReceiptName(item.rawName)
      const alias = aliasesByNormalized.get(normalized)
      const directIngredient = ingredientsByNormalized.get(normalized)
      const ingredient = alias?.ingredient ?? directIngredient ?? null
      const defaultUnit = ingredient?.default_unit ?? 'unidad'
      // Los productos a peso traen los kilos exactos; si el producto se mide en
      // gramos se pasan a gramos y, si no, se guardan en kilos.
      const weighed = item.weightKg != null
      const unit: Unit = weighed ? (defaultUnit === 'g' ? 'g' : 'kg') : defaultUnit
      const quantity = weighed
        ? numberToInputValue(unit === 'g' ? item.weightKg! * 1000 : item.weightKg!, 'quantity')
        : String(defaultUnit === 'unidad' && item.packages ? item.packages : 1)
      return {
        id: lineId(index),
        rawName: item.rawName,
        translatedName: ingredient?.name ?? item.rawName,
        ingredientId: ingredient?.id ?? '',
        category: ingredient?.category ?? 'Otros',
        quantity,
        unit,
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
    setSourceMode('ocr')
    setReading(true)
    setProgress('Preparando imagen…')
    let worker: Awaited<ReturnType<typeof createWorker>> | null = null

    try {
      const variants = await buildReceiptImageVariants(file)
      // Los ficheros del OCR se sirven desde la propia app (los copia scripts/copy-ocr-assets.mjs).
      const ocrBase = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.origin).href
      worker = await createWorker('spa', 1, {
        workerPath: `${ocrBase}worker.min.js`,
        corePath: ocrBase,
        langPath: `${ocrBase}lang`,
        workerBlobURL: false,
      })
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
      } as never)

      const readings: { text: string; score: number }[] = []

      for (let index = 0; index < variants.length; index += 1) {
        const variant = variants[index]
        setProgress(`Leyendo ticket… ${index + 1}/${variants.length}`)
        const result = await worker.recognize(variant.source)
        const candidateText = result.data.text
        readings.push({ text: candidateText, score: scoreReceiptText(candidateText, result.data.confidence) })
      }

      // Cada versión de la imagen acierta en líneas distintas, así que se combinan
      // todas las lecturas, empezando por la que mejor puntúa.
      applyReceiptText(readings.sort((a, b) => b.score - a.score).map((reading) => reading.text))
      setProgress('')
    } catch (cause) {
      setError(friendlyError(cause, 'No se pudo leer el ticket.'))
      setProgress('')
    } finally {
      if (worker) await worker.terminate()
      setReading(false)
      event.target.value = ''
    }
  }

  // Rellena la revisión a partir de una o varias lecturas del mismo ticket (las
  // versiones de una foto, o el texto de un PDF). Si se reconoce la tienda
  // (Mercadona, Aldi, Consum) se usa su lector; si no, el genérico.
  function applyReceiptText(texts: string[]) {
    setReadTexts(texts)
    setCopied(false)
    const reading = readReceiptTexts(texts)
    setLines(buildReviewLines(reading.lines))
    if (reading.store) setStoreName(reading.store)
    setTicketDiscount(reading.discount)
    if (reading.total != null) setTotalAmount(String(reading.total))
    if (reading.date) setPurchasedAt(localDatetimeValue(reading.date))
  }

  // Ticket digital en PDF (por ejemplo, el que Mercadona envía por correo). El
  // texto va dentro del PDF, así que no hace falta OCR.
  async function handlePdf(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setSuccess('')
    setSourceMode('ocr')
    setReading(true)
    setProgress('Leyendo PDF…')

    try {
      const { extractPdfText } = await import('../lib/receipt-pdf')
      const text = await extractPdfText(file)
      if (!text.trim()) throw new Error('El PDF no contiene texto. Si es un ticket escaneado, usa la opción de foto.')

      applyReceiptText([text])
      setProgress('')
    } catch (cause) {
      setError(friendlyError(cause, 'No se pudo leer el PDF.'))
      setProgress('')
    } finally {
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

  function blankLine(index: number): ReviewLine {
    return {
      id: lineId(index),
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
    }
  }

  function addManualLine() {
    const line = blankLine(lines.length)
    setLines((current) => [...current, line])
    setExpandedId(line.id)
  }

  function startEmptyTicket() {
    setStoreName('')
    setPurchasedAt(localDatetimeValue())
    setTotalAmount('')
    setTicketDiscount(0)
    setError('')
    setSuccess('')
    setProgress('')
    setSourceMode('manual')
    setReadTexts([])
    const line = blankLine(0)
    setLines([line])
    setExpandedId(line.id)
  }

  function reset() {
    setLines([])
    setStoreName('')
    setPurchasedAt(localDatetimeValue())
    setTotalAmount('')
    setTicketDiscount(0)
    setError('')
    setSuccess('')
    setProgress('')
    setSourceMode(null)
    setReadTexts([])
  }

  async function copyReadText() {
    const text = readTexts.map((reading, index) => readTexts.length > 1 ? `--- Lectura ${index + 1} ---\n${reading}` : reading).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setError('No se pudo copiar. Selecciona el texto y cópialo a mano.')
    }
  }

  const selectedLines = lines.filter((line) => line.include)
  const detectedTotal = selectedLines.reduce((sum, line) => sum + (parseDecimalInput(line.totalPrice) ?? 0), 0) - ticketDiscount
  // Diferencia entre el total del ticket y la suma de las líneas (positiva si faltan líneas).
  const parsedTotal = totalAmount.trim() ? parseDecimalInput(totalAmount) : null
  const totalMismatch = parsedTotal != null && Math.abs(parsedTotal - detectedTotal) >= 0.01 ? Math.round((parsedTotal - detectedTotal) * 100) / 100 : null

  function pantryHint(line: ReviewLine) {
    if (!line.ingredientId || !line.addToPantry) return null
    const current = pantryByIngredient.get(line.ingredientId)
    if (!current) return 'Se creará en despensa con esta cantidad.'
    if (current.quantity == null) return 'Ahora se controla por estado: se marcará como “Tengo”.'
    const quantity = parseDecimalInput(line.quantity)
    if (quantity == null) return 'Cantidad inválida.'
    const converted = convertCompatibleQuantity(quantity, line.unit, current.unit ?? line.unit)
    if (converted == null) return 'Unidad incompatible con la despensa actual. Cámbiala antes de importar.'
    return `Se sumará a ${current.quantity} ${current.unit ?? ''} existentes.`
  }

  // Guarda el ticket. Desde el aviso de salir (fromLeaveDialog) no lleva a la
  // despensa: se va a donde se quería ir. Devuelve false si falta algo o falla.
  async function importReceipt(fromLeaveDialog = false): Promise<boolean> {
    if (!supabase) return false
    setError('')
    setSuccess('')
    const invalid = (message: string) => { setError(message); return false }
    if (!storeName.trim()) return invalid('Revisa el nombre de la tienda.')
    const parsedTotalAmount = parseDecimalInput(totalAmount)
    if (parsedTotalAmount == null || parsedTotalAmount < 0) return invalid('Revisa el total del ticket.')
    if (!selectedLines.length) return invalid('Selecciona al menos un producto.')

    for (const line of selectedLines) {
      if (!line.rawName.trim() || !line.translatedName.trim()) return invalid('Todos los productos seleccionados necesitan concepto y traducción.')
      const parsedQuantity = parseDecimalInput(line.quantity)
      const parsedLinePrice = line.totalPrice ? parseDecimalInput(line.totalPrice) : 0
      if (parsedQuantity == null || parsedQuantity <= 0) return invalid(`Revisa la cantidad de ${line.translatedName || line.rawName}.`)
      if (parsedLinePrice == null || parsedLinePrice < 0) return invalid(`Revisa el precio de ${line.translatedName || line.rawName}.`)
      const hint = pantryHint(line)
      if (line.addToPantry && hint?.startsWith('Unidad incompatible')) return invalid(`${line.translatedName}: ${hint}`)
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

    if (importError) return invalid(friendlyError(importError, 'No se pudo importar el ticket.'))
    const pantryLines = selectedLines.filter((line) => line.addToPantry)
    const plural = (count: number) => `${count} producto${count === 1 ? '' : 's'}`
    // Se limpia la revisión para no importar el mismo ticket dos veces.
    setLeaveGuard(null)
    reset()
    await loadReferenceData()
    if (fromLeaveDialog) return true
    if (pantryLines.length && onImported) {
      // Se lleva a la despensa para comprobar que todo ha entrado bien.
      onImported({
        message: `Ticket de ${storeName.trim()} importado: ${plural(pantryLines.length)} añadido${pantryLines.length === 1 ? '' : 's'} a la despensa.`,
        names: pantryLines.map((line) => line.translatedName.trim()),
      })
      return true
    }
    setSuccess(`Compra guardada en el historial (${plural(selectedLines.length)}). Ninguno se ha añadido a la despensa.`)
    return true
  }

  // Revisión a medias: se avisa al cambiar de sección o de pestaña, al empezar otro ticket y al cerrar la página.
  const dirty = !saving && (sourceMode === 'ocr' ? lines.length > 0 : lines.some((line) => line.rawName.trim() || line.totalPrice.trim()) || Boolean(storeName.trim()))
  const pantryCountForGuard = lines.filter((line) => line.include && line.addToPantry).length
  const leaveGuard = {
    what: storeName.trim() ? `el ticket de ${storeName.trim()}` : 'el ticket',
    save: () => importReceipt(true),
    saveLabel: pantryCountForGuard ? 'Añadir a despensa y salir' : 'Guardar compra y salir',
  }
  useEffect(() => {
    if (!dirty) { setLeaveGuard(null); return }
    setLeaveGuard(leaveGuard)
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  })
  useEffect(() => () => setLeaveGuard(null), [])

  if (!lines.length && !reading) {
    return <div className="space-y-5">
      {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-neutral-100"><ReceiptText size={25} /></div>
          <h2 className="mt-4 text-xl font-semibold">Importar ticket</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">Puedes leer un ticket desde una foto, subir el PDF del ticket digital (como el que Mercadona envía por correo) o crear uno vacío y rellenarlo manualmente. En ambos casos revisarás todos los productos antes de guardar.</p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-neutral-900 px-5 py-3 text-sm font-semibold text-white">
              <Camera size={18} /> Hacer foto o elegir ticket
              <input type="file" accept="image/*" capture="environment" onChange={handleImage} className="hidden" />
            </label>
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-5 py-3 text-sm font-semibold text-neutral-700">
              <FileText size={18} /> Subir PDF
              <input type="file" accept="application/pdf,.pdf" onChange={handlePdf} className="hidden" />
            </label>
            <button type="button" onClick={startEmptyTicket} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-5 py-3 text-sm font-semibold text-neutral-700">
              <FilePlus2 size={18} /> Crear ticket vacío
            </button>
          </div>
          <div className="mt-5 grid gap-2 text-left text-xs text-neutral-500 sm:grid-cols-3">
            <div className="rounded-2xl bg-neutral-50 p-3"><span className="font-semibold text-neutral-700">1. Leer</span><p className="mt-1">Extrae los conceptos y precios visibles.</p></div>
            <div className="rounded-2xl bg-neutral-50 p-3"><span className="font-semibold text-neutral-700">2. Traducir</span><p className="mt-1">Corrige abreviaturas y asocia alimentos.</p></div>
            <div className="rounded-2xl bg-neutral-50 p-3"><span className="font-semibold text-neutral-700">3. Confirmar</span><p className="mt-1">Revisa cantidades y decide qué entra en despensa.</p></div>
          </div>
        </div>
      </section>
      <ReceiptAliasesCard />
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

  const money = (value: number) => value.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })
  const pantryCount = selectedLines.filter((line) => line.addToPantry).length
  const inputClass = 'w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-sm font-normal text-neutral-800'
  const priceClass = (line: ReviewLine) => `${inputClass} text-right ${line.include && !line.totalPrice.trim() ? 'border-amber-300 bg-amber-50' : ''}`

  function updateRawName(line: ReviewLine, value: string) {
    if (sourceMode === 'manual') {
      const ingredient = ingredientsByNormalized.get(normalizeReceiptName(value))
      updateLine(line.id, {
        rawName: value,
        translatedName: ingredient?.name ?? value,
        ingredientId: ingredient?.id ?? '',
        category: ingredient?.category ?? line.category,
        unit: ingredient?.default_unit ?? line.unit,
        matchedByAlias: false,
      })
    } else {
      updateLine(line.id, { rawName: value, matchedByAlias: false })
    }
  }

  function removeLine(id: string) {
    setLines((current) => current.filter((item) => item.id !== id))
  }

  // Campos que se comparten entre la fila del ordenador y la ficha desplegada del móvil.
  const fields = (line: ReviewLine) => ({
    rawName: <input aria-label={sourceMode === 'manual' ? 'Producto' : 'Concepto del ticket'} list={sourceMode === 'manual' ? 'receipt-ingredients' : undefined} value={line.rawName} onChange={(e) => updateRawName(line, e.target.value)} placeholder={sourceMode === 'manual' ? 'Buscar o escribir producto' : undefined} className={inputClass} />,
    translatedName: <input aria-label={sourceMode === 'manual' ? 'Producto del catálogo' : 'Qué es realmente'} list="receipt-ingredients" value={line.translatedName} onChange={(e) => updateTranslatedName(line, e.target.value)} placeholder="Ej. Pechuga de pavo" className={inputClass} />,
    quantity: <NumberInput aria-label="Cantidad" kind="quantity" value={line.quantity} onValueChange={(input) => updateLine(line.id, { quantity: input })} className={inputClass} />,
    unit: <select aria-label="Unidad" value={line.unit} onChange={(e) => updateLine(line.id, { unit: e.target.value as Unit })} className={inputClass}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select>,
    price: <NumberInput aria-label="Precio de la línea" kind="money" value={line.totalPrice} onValueChange={(input) => updateLine(line.id, { totalPrice: input })} placeholder="—" className={priceClass(line)} />,
    category: <select aria-label="Categoría del nuevo alimento" value={line.category} onChange={(e) => updateLine(line.id, { category: e.target.value })} className={`${inputClass} border-amber-300 bg-amber-50 py-1.5 text-xs`}>{categories.map((category) => <option key={category}>{category}</option>)}</select>,
  })

  return <div className="space-y-4 pb-2">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-sm font-medium text-neutral-500">{sourceMode === 'manual' ? 'Ticket manual' : 'Ticket leído'}</p><h2 className="mt-0.5 text-xl font-semibold sm:text-2xl">{sourceMode === 'manual' ? 'Crear ticket' : 'Revisar antes de importar'}</h2><p className="mt-1 hidden text-sm text-neutral-500 sm:block">{sourceMode === 'manual' ? 'Añade los productos uno a uno y revisa cantidades, unidades y precios antes de guardar.' : 'Corrige todo lo que necesites. Nada se guarda hasta confirmar.'}</p></div>
      <button onClick={() => { if (dirty) setConfirmReset(true); else reset() }} className="flex shrink-0 items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-600"><RotateCcw size={16} /> Otro ticket</button>
    </div>
    {confirmReset && <UnsavedChangesDialog guard={leaveGuard} onStay={() => setConfirmReset(false)} onLeave={() => { setConfirmReset(false); setLeaveGuard(null); reset() }} />}

    {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    {success && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div>}

    <section className="grid grid-cols-2 gap-3 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_220px_160px] lg:items-end">
      <label className="col-span-2 text-xs font-medium text-neutral-500 lg:col-span-1">Tienda<input value={storeName} onChange={(e) => setStoreName(e.target.value)} className={`mt-1 ${inputClass}`} /></label>
      <label className="text-xs font-medium text-neutral-500">Fecha y hora<input type="datetime-local" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} className={`mt-1 ${inputClass}`} /></label>
      <label className="text-xs font-medium text-neutral-500">Total del ticket<NumberInput kind="money" value={totalAmount} onValueChange={(input) => setTotalAmount(input)} className={`mt-1 ${inputClass}`} /></label>
      {readTexts.length > 0 && <details className="col-span-2 text-xs lg:col-span-3">
        <summary className="cursor-pointer font-medium text-neutral-500">Ver texto leído</summary>
        <div className="mt-2">
          <p className="text-neutral-500">Es lo que la app ha leído del ticket{readTexts.length > 1 ? ', una vez por cada versión de la imagen' : ''}. Si algo sale mal, cópialo y envíalo para mejorar la lectura.</p>
          <button type="button" onClick={() => void copyReadText()} className="mt-2 rounded-xl border border-neutral-200 px-3 py-2 font-semibold text-neutral-700">{copied ? 'Copiado' : 'Copiar texto'}</button>
          <div className="grid gap-2 lg:grid-cols-2">{readTexts.map((text, index) => <pre key={index} className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-neutral-50 p-3 text-neutral-600">{text}</pre>)}</div>
        </div>
      </details>}
    </section>

    <datalist id="receipt-ingredients">{ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.name} />)}</datalist>

    <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
      {isWide && <div className="grid grid-cols-[20px_minmax(0,1fr)_minmax(0,1.2fr)_170px_80px_110px_96px_72px] gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        <span /><span>{sourceMode === 'manual' ? 'Producto' : 'Concepto del ticket'}</span><span>{sourceMode === 'manual' ? 'Producto del catálogo' : 'Qué es realmente'}</span><span>Categoría</span><span>Cantidad</span><span>Unidad</span><span className="text-right">Precio</span><span />
      </div>}
      <div className="divide-y divide-neutral-100">
        {lines.map((line) => {
          const hint = pantryHint(line)
          const incompatible = Boolean(hint?.startsWith('Unidad incompatible'))
          const field = fields(line)
          const include = <input type="checkbox" checked={line.include} onChange={(e) => updateLine(line.id, { include: e.target.checked })} className="h-4 w-4 shrink-0" aria-label="Incluir producto" />
          const badges = <>
            {!line.ingredientId && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Nuevo</span>}
            {line.matchedByAlias && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Recordado</span>}
            {!line.addToPantry && <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">Sin despensa</span>}
          </>

          if (isWide) {
            return <div key={line.id} className={`px-4 py-2 ${line.include ? '' : 'opacity-50'}`}>
              <div className="grid grid-cols-[20px_minmax(0,1fr)_minmax(0,1.2fr)_170px_80px_110px_96px_72px] items-center gap-2">
                {include}{field.rawName}{field.translatedName}
                {/* Si es un alimento nuevo se elige su categoría; si ya existe, solo se informa. */}
                {line.ingredientId
                  ? <span className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-400"><span className="truncate">{line.category}</span>{line.matchedByAlias && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">Recordado</span>}</span>
                  : <span title={`Se creará el alimento “${line.translatedName || '…'}”`}>{field.category}</span>}
                {field.quantity}{field.unit}{field.price}
                <div className="flex justify-end">
                  <button type="button" onClick={() => updateLine(line.id, { addToPantry: !line.addToPantry })} aria-pressed={line.addToPantry} title={line.addToPantry ? `Irá a la despensa. ${hint ?? ''}`.trim() : 'No irá a la despensa'} className={`grid h-8 w-8 place-items-center rounded-lg ${line.addToPantry ? 'bg-emerald-50 text-emerald-700' : 'text-neutral-300 hover:bg-neutral-100'}`}><PackagePlus size={16} /></button>
                  <button type="button" onClick={() => removeLine(line.id)} title="Quitar línea" aria-label="Quitar línea" className="grid h-8 w-8 place-items-center rounded-lg text-neutral-300 hover:bg-red-50 hover:text-red-600"><Trash2 size={16} /></button>
                </div>
              </div>
              {incompatible && <p className="mt-1 pl-7 text-xs text-red-600">{hint}</p>}
            </div>
          }

          const open = expandedId === line.id
          const title = line.translatedName || line.rawName || 'Producto sin nombre'
          return <div key={line.id} className={line.include ? '' : 'opacity-50'}>
            <div className="flex items-center gap-3 px-3 py-2.5">
              {include}
              <button type="button" onClick={() => setExpandedId(open ? null : line.id)} aria-expanded={open} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-sm font-medium text-neutral-900">{title}</span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-neutral-400"><span className="truncate">{line.rawName && line.rawName !== title ? `${line.rawName} · ` : ''}{line.quantity} {line.unit}</span>{badges}</span>
              </button>
              <div className="w-20 shrink-0">{field.price}</div>
              <button type="button" onClick={() => setExpandedId(open ? null : line.id)} aria-label={open ? 'Cerrar' : 'Editar'} className="grid h-8 w-6 shrink-0 place-items-center text-neutral-400"><ChevronDown size={18} className={`transition ${open ? 'rotate-180' : ''}`} /></button>
            </div>
            {open && <div className="grid grid-cols-2 gap-2 bg-neutral-50 px-3 pb-3 pt-2 text-xs font-medium text-neutral-500">
              <label className="col-span-2">{sourceMode === 'manual' ? 'Producto' : 'Concepto del ticket'}<div className="mt-1">{field.rawName}</div></label>
              <label className="col-span-2">{sourceMode === 'manual' ? 'Producto del catálogo' : 'Qué es realmente'}<div className="mt-1">{field.translatedName}</div></label>
              <label>Cantidad<div className="mt-1">{field.quantity}</div></label>
              <label>Unidad<div className="mt-1">{field.unit}</div></label>
              {!line.ingredientId && <label className="col-span-2">Se creará como alimento nuevo en la categoría<div className="mt-1">{field.category}</div></label>}
              <div className="col-span-2 flex items-center justify-between gap-3 pt-1">
                <label className="flex items-center gap-2 text-neutral-700"><input type="checkbox" checked={line.addToPantry} onChange={(e) => updateLine(line.id, { addToPantry: e.target.checked })} /> Añadir a despensa</label>
                <button type="button" onClick={() => removeLine(line.id)} className="flex items-center gap-1 text-red-500"><Trash2 size={14} /> Quitar línea</button>
              </div>
              {hint && <p className={`col-span-2 font-normal ${incompatible ? 'text-red-600' : 'text-neutral-400'}`}>{hint}</p>}
            </div>}
          </div>
        })}
      </div>
      <button onClick={addManualLine} className="flex w-full items-center gap-2 border-t border-neutral-100 px-4 py-3 text-sm font-medium text-neutral-600 hover:bg-neutral-50"><Plus size={17} /> Añadir línea</button>
    </section>

    <div className="sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] z-10 flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur lg:bottom-4 lg:rounded-3xl lg:p-4">
      <div className="min-w-0 text-xs text-neutral-500">
        <p className="text-sm font-semibold text-neutral-900">{selectedLines.length} productos · {money(detectedTotal)}</p>
        {totalMismatch != null
          ? <p className="mt-0.5 font-medium text-amber-700">{totalMismatch > 0 ? 'Faltan' : 'Sobran'} {money(Math.abs(totalMismatch))} para cuadrar<span className="hidden sm:inline"> con el total del ticket</span></p>
          : <p className="mt-0.5 truncate">{parsedTotal != null ? 'Cuadra con el total' : 'Indica el total del ticket'}{ticketDiscount > 0 ? ` (con ${money(ticketDiscount)} de descuento)` : ''}<span className="hidden sm:inline"> · {pantryCount} a despensa</span></p>}
      </div>
      <button disabled={saving || !selectedLines.length} onClick={() => void importReceipt()} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 lg:rounded-2xl lg:py-3">{saving ? <><LoaderCircle className="animate-spin" size={17} /> Guardando…</> : <><CheckCircle2 size={17} /> {pantryCount ? 'Añadir a despensa' : 'Guardar compra'}</>}</button>
    </div>
  </div>
}
