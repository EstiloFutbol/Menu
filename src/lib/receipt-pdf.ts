import type { TextItem } from 'pdfjs-dist/types/src/display/api'

// Extrae el texto de un PDF con texto real (no escaneado), una línea por renglón.
// pdf.js devuelve trozos sueltos con su posición; se agrupan por altura y se
// ordenan de izquierda a derecha para reconstruir cada línea del ticket.
export async function extractPdfText(file: File) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const document = await loadingTask.promise
  const lines: string[] = []

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items.filter((item): item is TextItem => 'str' in item && item.str.trim() !== '')
      lines.push(...groupIntoLines(items.map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5] }))))
    }
  } finally {
    await loadingTask.destroy()
  }

  return lines.join('\n')
}

export type PositionedText = { text: string; x: number; y: number }

export function groupIntoLines(items: PositionedText[], tolerance = 2) {
  const rows: { y: number; items: PositionedText[] }[] = []
  for (const item of items) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance)
    if (row) row.items.push(item)
    else rows.push({ y: item.y, items: [item] })
  }
  // En PDF la y crece hacia arriba, así que la primera línea es la de mayor y.
  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text.trim()).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}
