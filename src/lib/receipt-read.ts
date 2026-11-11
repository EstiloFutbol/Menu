import { extractReceiptDate, extractReceiptTotal, guessStoreName, parseReceiptText, type ParsedReceiptLine } from './receipt'
import { mergeReceiptReadings } from './receipt-merge'
import { parseStoreReceipt, type ParsedStoreReceipt } from './store-receipts'

export type ReceiptReading = {
  store: string | null
  date: Date | null
  total: number | null
  lines: ParsedReceiptLine[]
}

// Interpreta una o varias lecturas del mismo ticket (las versiones de una foto,
// o el texto de un PDF). Si se reconoce la tienda (Mercadona, Aldi, Consum) se
// usa su lector; si no, el genérico. Es la misma lógica para la app y para el
// banco de pruebas (scripts/ocr-bench.ts).
export function readReceiptTexts(texts: string[]): ReceiptReading {
  const storeReadings = texts.map(parseStoreReceipt).filter((receipt): receipt is ParsedStoreReceipt => receipt !== null)
  if (storeReadings.length) {
    const total = storeReadings.find((receipt) => receipt.total != null)?.total ?? null
    const date = storeReadings.find((receipt) => receipt.date)?.date ?? null
    return {
      store: storeReadings[0].store,
      date,
      total,
      lines: mergeReceiptReadings(storeReadings.map((receipt) => receipt.lines), total),
    }
  }

  const total = texts.map(extractReceiptTotal).find((value) => value != null) ?? null
  return {
    store: texts.map(guessStoreName).find(Boolean) ?? null,
    date: texts.map(extractReceiptDate).find(Boolean) ?? null,
    total,
    lines: mergeReceiptReadings(texts.map(parseReceiptText), total),
  }
}
