// Preprocesado de la foto del ticket sobre píxeles en bruto, sin depender del
// navegador. Lo usan la app (receipt-image.ts, con canvas) y el banco de pruebas
// (scripts/ocr-bench.ts, con sharp en Node), así ambos procesan igual.

export type GrayImage = { data: Uint8Array; width: number; height: number }
export type ReceiptPixelVariant = { label: string; image: GrayImage }

// Ancho al que se reescala la foto antes del OCR.
export function receiptTargetSize(width: number, height: number) {
  const targetWidth = Math.min(2400, Math.max(1600, width))
  const scale = targetWidth / width
  return { width: targetWidth, height: Math.round(height * scale) }
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, value))
}

// RGBA → gris (luminancia perceptual).
export function toGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height)
  for (let pixel = 0, index = 0; index < data.length; pixel += 4, index += 1) {
    data[index] = Math.round(0.299 * rgba[pixel] + 0.587 * rgba[pixel + 1] + 0.114 * rgba[pixel + 2])
  }
  return { data, width, height }
}

// Estira el rango de grises a 0-255 y sube el contraste.
export function enhanceContrast(image: GrayImage): GrayImage {
  let min = 255
  let max = 0
  for (const value of image.data) {
    if (value < min) min = value
    if (value > max) max = value
  }
  const range = Math.max(1, max - min)
  const data = new Uint8Array(image.data.length)
  for (let index = 0; index < data.length; index += 1) {
    const normalized = ((image.data[index] - min) / range) * 255
    data[index] = clamp((normalized - 128) * 1.35 + 128)
  }
  return { data, width: image.width, height: image.height }
}

// Método de Bradley: un píxel es tinta si es claramente más oscuro (un
// `sensitivity` por ciento) que la media de la ventana que lo rodea. La media se
// calcula con una imagen integral, así cuesta lo mismo sea cual sea la ventana.
export function adaptiveThreshold(luminance: Uint8Array, width: number, height: number, sensitivity = 0.15) {
  const window = Math.max(15, Math.round(width / 40)) | 1
  const half = window >> 1
  const integral = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0
    for (let x = 0; x < width; x += 1) {
      rowSum += luminance[y * width + x]
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum
    }
  }

  const output = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(height, y + half + 1)
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(width, x + half + 1)
      const area = (x1 - x0) * (y1 - y0)
      const sum = integral[y1 * (width + 1) + x1] - integral[y0 * (width + 1) + x1] - integral[y1 * (width + 1) + x0] + integral[y0 * (width + 1) + x0]
      output[y * width + x] = luminance[y * width + x] * area < sum * (1 - sensitivity) ? 0 : 255
    }
  }
  return output
}

// Versiones de la foto que se pasan al OCR. Cada una acierta en líneas
// distintas; luego se combinan (receipt-merge.ts).
export function buildReceiptPixelVariants(rgba: ArrayLike<number>, width: number, height: number): ReceiptPixelVariant[] {
  return buildGrayVariants(prepareReceipt(toGray(rgba, width, height)))
}

// Recorta y endereza el ticket si se distingue del fondo; si no, deja la foto como está.
export function prepareReceipt(gray: GrayImage): GrayImage {
  const quad = locateReceipt(gray)
  return quad ? warpReceipt(gray, quad, RECEIPT_WARP_WIDTH) : gray
}

function buildGrayVariants(gray: GrayImage): ReceiptPixelVariant[] {
  const { width, height } = gray
  return [
    // Enfocada: realza los bordes de las cifras (la tipografía estrecha del ticket
    // hace que se confundan 6/5, 9/3 y 0/9 cuando la foto está algo borrosa).
    { label: 'enfocada', image: enhanceContrast(sharpen(gray)) },
    { label: 'contraste', image: enhanceContrast(gray) },
    // Umbral adaptativo: cada píxel se compara con la media de su entorno en vez
    // de con un valor fijo, así una sombra o un lado más oscuro no borran el texto.
    { label: 'blanco y negro adaptativo', image: { data: adaptiveThreshold(gray.data, width, height), width, height } },
  ]
}

// Máscara de enfoque: resta al píxel la media de sus vecinos para marcar los bordes.
export function sharpen(image: GrayImage, amount = 1.2): GrayImage {
  const { width, height, data } = image
  const output = new Uint8Array(data.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy
        if (yy < 0 || yy >= height) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx
          if (xx < 0 || xx >= width) continue
          sum += data[yy * width + xx]
          count += 1
        }
      }
      const value = data[y * width + x]
      output[y * width + x] = clamp(value + amount * (value - sum / count))
    }
  }
  return { data: output, width, height }
}

// ---------------------------------------------------------------------------
// Fase 2: encontrar el ticket en la foto, recortarlo y enderezarlo.
// El papel del ticket es lo más claro de la foto. Se busca la zona clara que
// contiene el centro, se toman sus cuatro esquinas y se "aplana" ese
// cuadrilátero a un rectángulo (corrige giro y perspectiva). Así el texto ocupa
// toda la imagen y el OCR lo ve más grande y recto.

export type Point = { x: number; y: number }
export type Quad = { topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point }

function downscale(image: GrayImage, maxWidth: number) {
  const factor = Math.max(1, Math.ceil(image.width / maxWidth))
  const width = Math.floor(image.width / factor)
  const height = Math.floor(image.height / factor)
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let dy = 0; dy < factor; dy += 1) for (let dx = 0; dx < factor; dx += 1) sum += image.data[(y * factor + dy) * image.width + x * factor + dx]
      data[y * width + x] = sum / (factor * factor)
    }
  }
  return { image: { data, width, height }, factor }
}

// Esquinas del ticket en la foto, o null si no se distingue bien del fondo.
export function locateReceipt(gray: GrayImage): Quad | null {
  const { image: small, factor } = downscale(gray, 360)
  const { width, height, data } = small
  // Brillo del papel: lo más claro de la zona central (el texto es oscuro y ocupa poco).
  const center: number[] = []
  for (let y = Math.floor(height * 0.3); y < height * 0.7; y += 1) for (let x = Math.floor(width * 0.3); x < width * 0.7; x += 1) center.push(data[y * width + x])
  center.sort((a, b) => a - b)
  const paper = center[Math.floor(center.length * 0.9)]
  const threshold = paper * 0.8

  // Zona clara conectada que contiene el centro. Antes se "cierran" los huecos
  // del texto: un píxel cuenta como papel si en su entorno abunda el papel.
  const bright = new Uint8Array(width * height)
  for (let index = 0; index < bright.length; index += 1) bright[index] = data[index] >= threshold ? 1 : 0
  const closed = new Uint8Array(width * height)
  const radius = 2
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let count = 0
      let total = 0
      for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
        const yy = y + dy, xx = x + dx
        if (yy < 0 || xx < 0 || yy >= height || xx >= width) continue
        total += 1
        count += bright[yy * width + xx]
      }
      closed[y * width + x] = count / total >= 0.4 ? 1 : 0
    }
  }
  let seed = -1
  for (let ring = 0; ring < Math.min(width, height) / 4 && seed < 0; ring += 1) {
    for (let dy = -ring; dy <= ring && seed < 0; dy += 1) for (let dx = -ring; dx <= ring && seed < 0; dx += 1) {
      const index = (Math.floor(height / 2) + dy) * width + Math.floor(width / 2) + dx
      if (closed[index]) seed = index
    }
  }
  if (seed < 0) return null
  const region = new Uint8Array(width * height)
  const stack = [seed]
  region[seed] = 1
  let area = 0
  while (stack.length) {
    const index = stack.pop()!
    area += 1
    const x = index % width, y = (index - x) / width
    for (const next of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1, y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
      if (next >= 0 && closed[next] && !region[next]) { region[next] = 1; stack.push(next) }
    }
  }
  // Demasiado pequeño (no es el ticket) o casi toda la foto (no hay fondo que quitar).
  if (area < width * height * 0.12 || area > width * height * 0.92) return null

  // Esquinas: los puntos extremos en diagonal.
  let topLeft = { x: 0, y: 0, score: Infinity }
  let bottomRight = { x: 0, y: 0, score: -Infinity }
  let topRight = { x: 0, y: 0, score: -Infinity }
  let bottomLeft = { x: 0, y: 0, score: Infinity }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!region[y * width + x]) continue
      if (x + y < topLeft.score) topLeft = { x, y, score: x + y }
      if (x + y > bottomRight.score) bottomRight = { x, y, score: x + y }
      if (x - y > topRight.score) topRight = { x, y, score: x - y }
      if (x - y < bottomLeft.score) bottomLeft = { x, y, score: x - y }
    }
  }
  // Se deja un margen alrededor: el borde del papel suele estar en sombra y es
  // mejor que sobre un poco de fondo a que falte la última cifra de un precio.
  const cx = (topLeft.x + topRight.x + bottomRight.x + bottomLeft.x) / 4
  const cy = (topLeft.y + topRight.y + bottomRight.y + bottomLeft.y) / 4
  const margin = 0.04
  const scale = (point: { x: number; y: number }): Point => ({
    x: Math.max(0, Math.min(gray.width - 1, (point.x + 0.5 + (point.x - cx) * margin * 2) * factor)),
    y: Math.max(0, Math.min(gray.height - 1, (point.y + 0.5 + (point.y - cy) * margin) * factor)),
  })
  return { topLeft: scale(topLeft), topRight: scale(topRight), bottomRight: scale(bottomRight), bottomLeft: scale(bottomLeft) }
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

// Homografía que lleva el rectángulo (0,0)-(w,h) al cuadrilátero de la foto.
function homography(quad: Quad, width: number, height: number) {
  const source = [[0, 0], [width, 0], [width, height], [0, height]]
  const target = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
  const matrix: number[][] = []
  for (let index = 0; index < 4; index += 1) {
    const [x, y] = source[index]
    const { x: u, y: v } = target[index]
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  // Eliminación de Gauss para las 8 incógnitas.
  for (let column = 0; column < 8; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 8; row += 1) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row
    ;[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]]
    for (let row = 0; row < 8; row += 1) {
      if (row === column) continue
      const ratio = matrix[row][column] / matrix[column][column]
      for (let k = column; k < 9; k += 1) matrix[row][k] -= ratio * matrix[column][k]
    }
  }
  return matrix.map((row, index) => row[8] / row[index]).concat(1)
}

// Aplana el ticket a un rectángulo de `outputWidth` píxeles de ancho (interpolación bilineal).
export function warpReceipt(gray: GrayImage, quad: Quad, outputWidth: number): GrayImage {
  const quadWidth = (distance(quad.topLeft, quad.topRight) + distance(quad.bottomLeft, quad.bottomRight)) / 2
  const quadHeight = (distance(quad.topLeft, quad.bottomLeft) + distance(quad.topRight, quad.bottomRight)) / 2
  const width = Math.round(outputWidth)
  const height = Math.round(outputWidth * (quadHeight / quadWidth))
  const [a, b, c, d, e, f, g, h] = homography(quad, width, height)
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const w = g * x + h * y + 1
      const u = (a * x + b * y + c) / w
      const v = (d * x + e * y + f) / w
      const x0 = Math.floor(u), y0 = Math.floor(v)
      if (x0 < 0 || y0 < 0 || x0 >= gray.width - 1 || y0 >= gray.height - 1) { data[y * width + x] = 255; continue }
      const fx = u - x0, fy = v - y0
      const top = gray.data[y0 * gray.width + x0] * (1 - fx) + gray.data[y0 * gray.width + x0 + 1] * fx
      const bottom = gray.data[(y0 + 1) * gray.width + x0] * (1 - fx) + gray.data[(y0 + 1) * gray.width + x0 + 1] * fx
      data[y * width + x] = top * (1 - fy) + bottom * fy
    }
  }
  return { data, width, height }
}

// Ancho del ticket ya recortado: el texto queda a un tamaño cómodo para el OCR.
export const RECEIPT_WARP_WIDTH = 1800
