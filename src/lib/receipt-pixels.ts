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
  const gray = toGray(rgba, width, height)
  return [
    { label: 'contraste', image: enhanceContrast(gray) },
    // Umbral adaptativo: cada píxel se compara con la media de su entorno en vez
    // de con un valor fijo, así una sombra o un lado más oscuro no borran el texto.
    { label: 'blanco y negro adaptativo', image: { data: adaptiveThreshold(gray.data, width, height), width, height } },
  ]
}
