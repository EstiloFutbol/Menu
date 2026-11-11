// Banco de pruebas del escaneo de tickets.
//
// Ejecuta sobre fotos reales el MISMO preprocesado y el MISMO Tesseract que la
// app, y compara el resultado con la "verdad" de cada ticket. Sirve para medir
// si un cambio mejora o empeora la lectura antes de llevarlo a la app.
//
// Uso:  npm run bench:ocr                  (todas las fotos de tickets-privados/)
//       npm run bench:ocr -- foto1 foto2   (solo esas)
//
// tickets-privados/ está en .gitignore: las fotos y la verdad NUNCA se suben al
// repositorio (son datos personales). Por cada foto <nombre>.jpg|png|webp puede
// haber un <nombre>.verdad.json con lo que de verdad dice el ticket:
//   { "tienda": "Mercadona", "total": 23.45,
//     "lineas": [ { "nombre": "LECHE SEMI", "precio": 0.89 }, ... ] }
// Sin verdad, solo se muestra lo leído. Los textos del OCR se guardan en
// tickets-privados/salida/ para revisarlos.
import { mkdirSync, readdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import sharp from 'sharp'
import { createWorker } from 'tesseract.js'
import { buildReceiptPixelVariants, receiptTargetSize } from '../src/lib/receipt-pixels'
import { readReceiptTexts } from '../src/lib/receipt-read'
import { nameSimilarity } from '../src/lib/receipt-merge'
import { scoreReceiptText } from '../src/lib/receipt'

type Truth = { tienda?: string; total?: number; lineas: { nombre: string; precio: number }[] }

const root = join(import.meta.dirname, '..')
const folder = join(root, 'tickets-privados')
const outFolder = join(folder, 'salida')
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp'])

if (!existsSync(folder)) {
  console.error('No existe tickets-privados/. Crea la carpeta y pon dentro las fotos de los tickets.')
  process.exit(1)
}
mkdirSync(outFolder, { recursive: true })

const only = process.argv.slice(2)
const photos = readdirSync(folder)
  .filter((file) => imageExtensions.has(extname(file).toLowerCase()))
  .filter((file) => !only.length || only.some((name) => file.startsWith(name)))
  .sort()

if (!photos.length) {
  console.error('No hay fotos en tickets-privados/.')
  process.exit(1)
}

const worker = await createWorker('spa', 1, {
  langPath: join(root, 'node_modules/@tesseract.js-data/spa/4.0.0_best_int'),
  cachePath: join(outFolder, '.cache'),
})
await worker.setParameters({ tessedit_pageseg_mode: '6' as never, preserve_interword_spaces: '1' })

const cents = (value: number | null | undefined) => (value == null ? null : Math.round(value * 100))
const euros = (value: number | null | undefined) => (value == null ? '—' : value.toFixed(2))

type Result = { photo: string; truthLines: number; names: number; prices: number; extra: number; totalOk: boolean | null; sumOk: boolean | null; seconds: number }
const results: Result[] = []

for (const photo of photos) {
  const started = Date.now()
  const name = basename(photo, extname(photo))
  // Igual que createImageBitmap en el navegador: se respeta la orientación EXIF.
  const input = sharp(join(folder, photo)).rotate()
  const meta = await input.metadata()
  const oriented = (meta.orientation ?? 1) >= 5
  const sourceWidth = oriented ? meta.height! : meta.width!
  const sourceHeight = oriented ? meta.width! : meta.height!
  const { width, height } = receiptTargetSize(sourceWidth, sourceHeight)
  const { data } = await input.resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  const variants = buildReceiptPixelVariants(data, width, height)
  const readings: { text: string; score: number }[] = []
  for (const variant of variants) {
    const png = await sharp(Buffer.from(variant.image.data), { raw: { width, height, channels: 1 } }).png().toBuffer()
    const result = await worker.recognize(png)
    readings.push({ text: result.data.text, score: scoreReceiptText(result.data.text, result.data.confidence) })
    writeFileSync(join(outFolder, `${name}.${variant.label.replace(/\s+/g, '-')}.txt`), result.data.text)
  }
  const texts = readings.sort((a, b) => b.score - a.score).map((reading) => reading.text)
  const reading = readReceiptTexts(texts)
  const seconds = (Date.now() - started) / 1000

  console.log(`\n=== ${photo}  (${reading.store ?? 'tienda desconocida'}, total ${euros(reading.total)}, ${reading.lines.length} líneas, ${seconds.toFixed(1)} s)`)

  const truthFile = join(folder, `${name}.verdad.json`)
  if (!existsSync(truthFile)) {
    reading.lines.forEach((line) => console.log(`   ${line.rawName.padEnd(34)} ${euros(line.totalPrice)}`))
    continue
  }

  const truth = JSON.parse(readFileSync(truthFile, 'utf8')) as Truth
  const free = [...reading.lines]
  let names = 0
  let prices = 0
  for (const expected of truth.lineas) {
    let best = -1
    let bestScore = 0
    free.forEach((line, index) => {
      const score = nameSimilarity(line.rawName, expected.nombre) + (cents(line.totalPrice) === cents(expected.precio) ? 0.3 : 0)
      if (score > bestScore) { bestScore = score; best = index }
    })
    const found = best >= 0 && nameSimilarity(free[best].rawName, expected.nombre) >= 0.6 ? free.splice(best, 1)[0] : null
    const nameOk = Boolean(found)
    const priceOk = Boolean(found && cents(found.totalPrice) === cents(expected.precio))
    if (nameOk) names += 1
    if (priceOk) prices += 1
    console.log(`   ${nameOk ? (priceOk ? '✔' : '≈') : '✖'} ${expected.nombre.padEnd(30)} ${euros(expected.precio).padStart(7)}   leído: ${found ? `${found.rawName} ${euros(found.totalPrice)}` : '—'}`)
  }
  free.forEach((line) => console.log(`   + sobra: ${line.rawName} ${euros(line.totalPrice)}`))
  const sum = reading.lines.reduce((acc, line) => acc + (line.totalPrice ?? 0), 0) - reading.discount
  results.push({
    photo,
    truthLines: truth.lineas.length,
    names,
    prices,
    extra: free.length,
    totalOk: truth.total == null ? null : cents(reading.total) === cents(truth.total),
    sumOk: truth.total == null ? null : cents(sum) === cents(truth.total),
    seconds,
  })
}

await worker.terminate()

if (results.length) {
  const all = results.reduce((acc, r) => ({ lines: acc.lines + r.truthLines, names: acc.names + r.names, prices: acc.prices + r.prices, extra: acc.extra + r.extra }), { lines: 0, names: 0, prices: 0, extra: 0 })
  const pct = (part: number, whole: number) => `${whole ? Math.round((part / whole) * 100) : 0}%`
  console.log('\n=== RESUMEN')
  console.log(`Tickets con verdad: ${results.length}`)
  console.log(`Líneas leídas (nombre reconocible): ${all.names}/${all.lines} (${pct(all.names, all.lines)})`)
  console.log(`Líneas con precio correcto:         ${all.prices}/${all.lines} (${pct(all.prices, all.lines)})`)
  console.log(`Líneas que sobran:                  ${all.extra}`)
  console.log(`Total del ticket bien leído:        ${results.filter((r) => r.totalOk).length}/${results.filter((r) => r.totalOk != null).length}`)
  console.log(`La suma de líneas cuadra:           ${results.filter((r) => r.sumOk).length}/${results.filter((r) => r.sumOk != null).length}`)
  writeFileSync(join(outFolder, `resumen-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`), JSON.stringify({ all, results }, null, 2))
}
