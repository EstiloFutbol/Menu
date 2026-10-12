export type ReceiptImageVariant = {
  label: string
  source: Blob
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, value))
}

async function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo preparar la imagen.')), 'image/jpeg', 0.92)
  })
}

export async function buildReceiptImageVariants(file: File): Promise<ReceiptImageVariant[]> {
  const bitmap = await createImageBitmap(file)
  const targetWidth = Math.min(2400, Math.max(1600, bitmap.width))
  const scale = targetWidth / bitmap.width
  const targetHeight = Math.round(bitmap.height * scale)

  const baseCanvas = document.createElement('canvas')
  baseCanvas.width = targetWidth
  baseCanvas.height = targetHeight
  const baseContext = baseCanvas.getContext('2d', { willReadFrequently: true })
  if (!baseContext) {
    bitmap.close()
    throw new Error('No se pudo preparar la imagen.')
  }

  baseContext.imageSmoothingEnabled = true
  baseContext.imageSmoothingQuality = 'high'
  baseContext.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close()

  const image = baseContext.getImageData(0, 0, targetWidth, targetHeight)
  const luminance = new Uint8Array(targetWidth * targetHeight)
  let min = 255
  let max = 0

  for (let pixel = 0, index = 0; pixel < image.data.length; pixel += 4, index += 1) {
    const gray = Math.round(0.299 * image.data[pixel] + 0.587 * image.data[pixel + 1] + 0.114 * image.data[pixel + 2])
    luminance[index] = gray
    if (gray < min) min = gray
    if (gray > max) max = gray
  }

  const range = Math.max(1, max - min)
  const contrastCanvas = document.createElement('canvas')
  contrastCanvas.width = targetWidth
  contrastCanvas.height = targetHeight
  const contrastContext = contrastCanvas.getContext('2d')
  if (!contrastContext) throw new Error('No se pudo preparar la imagen.')

  const contrastImage = contrastContext.createImageData(targetWidth, targetHeight)
  for (let index = 0; index < luminance.length; index += 1) {
    const normalized = ((luminance[index] - min) / range) * 255
    const enhanced = clamp((normalized - 128) * 1.35 + 128)
    const offset = index * 4
    contrastImage.data[offset] = enhanced
    contrastImage.data[offset + 1] = enhanced
    contrastImage.data[offset + 2] = enhanced
    contrastImage.data[offset + 3] = 255
  }
  contrastContext.putImageData(contrastImage, 0, 0)

  // Umbral adaptativo: cada píxel se compara con la media de su entorno en vez
  // de con un valor fijo, así una sombra o un lado más oscuro no borran el texto.
  const binary = adaptiveThreshold(luminance, targetWidth, targetHeight)
  const thresholdCanvas = document.createElement('canvas')
  thresholdCanvas.width = targetWidth
  thresholdCanvas.height = targetHeight
  const thresholdContext = thresholdCanvas.getContext('2d')
  if (!thresholdContext) throw new Error('No se pudo preparar la imagen.')

  const thresholdImage = thresholdContext.createImageData(targetWidth, targetHeight)
  for (let index = 0; index < binary.length; index += 1) {
    const offset = index * 4
    thresholdImage.data[offset] = binary[index]
    thresholdImage.data[offset + 1] = binary[index]
    thresholdImage.data[offset + 2] = binary[index]
    thresholdImage.data[offset + 3] = 255
  }
  thresholdContext.putImageData(thresholdImage, 0, 0)

  return [
    { label: 'contraste', source: await canvasToBlob(contrastCanvas) },
    { label: 'blanco y negro adaptativo', source: await canvasToBlob(thresholdCanvas) },
  ]
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
