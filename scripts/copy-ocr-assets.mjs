// Copia a public/ocr los ficheros que tesseract.js necesita para leer tickets
// (worker, motor WebAssembly y modelo de español). Así la app los sirve desde su
// propio dominio en lugar de descargarlos de un CDN externo al leer una foto.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'public', 'ocr')
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', 'lang/spa.traineddata.gz'],
]

for (const [from, to] of files) {
  mkdirSync(dirname(join(target, to)), { recursive: true })
  copyFileSync(join(root, from), join(target, to))
}
console.log(`OCR: ${files.length} ficheros copiados a public/ocr`)
