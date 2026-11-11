import { extractReceiptDate, extractReceiptTotal, guessStoreName, parseReceiptText, type ParsedReceiptLine } from './receipt'
import { mergeReceiptReadings } from './receipt-merge'
import { parseStoreReceipt, type ParsedStoreReceipt } from './store-receipts'

export type ReceiptReading = {
  store: string | null
  date: Date | null
  total: number | null
  // Descuentos del ticket no ligados a un producto: la suma de líneas menos esto da el total.
  discount: number
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
    const discount = storeReadings.find((receipt) => receipt.discount)?.discount ?? 0
    return {
      store: storeReadings[0].store,
      date,
      total,
      discount,
      lines: mergeReceiptReadings(storeReadings.map((receipt) => receipt.lines), total == null ? null : Math.round((total + discount) * 100) / 100),
    }
  }

  const total = texts.map(extractReceiptTotal).find((value) => value != null) ?? null
  return {
    store: texts.map(guessStoreName).find(Boolean) ?? null,
    date: texts.map(extractReceiptDate).find(Boolean) ?? null,
    total,
    discount: 0,
    lines: mergeReceiptReadings(texts.map(parseReceiptText), total),
  }
}
