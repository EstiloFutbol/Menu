// Texto de un documento de Word (.docx) leído en el propio dispositivo, sin
// enviarlo a ningún sitio. Un .docx es un zip; el texto está en word/document.xml.
// Cada párrafo sale en una línea y cada fila de tabla en una línea con las
// celdas separadas por tabuladores ("Cebolla\t100 g").

export async function extractDocxText(data: ArrayBuffer) {
  const xml = await readZipEntry(new Uint8Array(data), 'word/document.xml')
  if (xml == null) throw new Error('El archivo no parece un documento de Word (.docx).')
  return docxXmlToText(xml)
}

const decodeEntities = (text: string) => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&amp;/g, '&')

function paragraphText(paragraph: string) {
  // Texto, tabuladores y saltos de línea en el orden en que aparecen.
  const parts = paragraph.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? []
  return decodeEntities(parts.map((part) => (part === '<w:tab/>' ? '\t' : part === '<w:br/>' ? '\n' : part.replace(/<[^>]+>/g, ''))).join(''))
}

export function docxXmlToText(xml: string) {
  const lines: string[] = []
  // Tablas (sin anidar) y párrafos sueltos, en el orden del documento.
  for (const block of xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []) {
    if (block.startsWith('<w:tbl>')) {
      for (const row of block.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []) {
        const cells = (row.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) ?? [])
          .map((cell) => (cell.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []).map(paragraphText).join(' ').trim())
        if (cells.some(Boolean)) lines.push(cells.join('\t'))
      }
    } else {
      lines.push(...paragraphText(block).split('\n'))
    }
  }
  return lines.map((line) => line.replace(/[  ]+/g, ' ').trim()).filter(Boolean).join('\n')
}

// Lector mínimo de zip: busca un archivo en el directorio central y lo
// descomprime (sin comprimir o con "deflate", lo que usa Word).
async function readZipEntry(bytes: Uint8Array, name: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65_557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break }
  }
  if (end === -1) return null
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  for (let entry = 0; entry < count; entry += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) return null
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const entryName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (entryName === name) {
      const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
      const data = bytes.slice(start, start + compressedSize)
      if (method === 0) return decoder.decode(data)
      if (method !== 8) throw new Error('El documento usa una compresión que no se puede leer.')
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return decoder.decode(await new Response(stream).arrayBuffer())
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  return null
}
