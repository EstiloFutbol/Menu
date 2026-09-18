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

  const thresholdCanvas = document.createElement('canvas')
  thresholdCanvas.width = targetWidth
  thresholdCanvas.height = targetHeight
  const thresholdContext = thresholdCanvas.getContext('2d')
  if (!thresholdContext) throw new Error('No se pudo preparar la imagen.')

  const thresholdImage = thresholdContext.createImageData(targetWidth, targetHeight)
  const threshold = 185
  for (let index = 0; index < luminance.length; index += 1) {
    const normalized = ((luminance[index] - min) / range) * 255
    const value = normalized > threshold ? 255 : 0
    const offset = index * 4
    thresholdImage.data[offset] = value
    thresholdImage.data[offset + 1] = value
    thresholdImage.data[offset + 2] = value
    thresholdImage.data[offset + 3] = 255
  }
  thresholdContext.putImageData(thresholdImage, 0, 0)

  return [
    { label: 'contraste', source: await canvasToBlob(contrastCanvas) },
    { label: 'alto contraste', source: await canvasToBlob(thresholdCanvas) },
  ]
}
