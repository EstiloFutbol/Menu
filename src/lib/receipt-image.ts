import { buildReceiptPixelVariants, receiptTargetSize, type GrayImage } from './receipt-pixels'

export { adaptiveThreshold } from './receipt-pixels'

export type ReceiptImageVariant = {
  label: string
  source: Blob
}

async function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo preparar la imagen.')), 'image/jpeg', 0.92)
  })
}

async function grayToBlob(image: GrayImage) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo preparar la imagen.')
  const output = context.createImageData(image.width, image.height)
  for (let index = 0; index < image.data.length; index += 1) {
    const offset = index * 4
    output.data[offset] = image.data[index]
    output.data[offset + 1] = image.data[index]
    output.data[offset + 2] = image.data[index]
    output.data[offset + 3] = 255
  }
  context.putImageData(output, 0, 0)
  return canvasToBlob(canvas)
}

// Reescala la foto con el canvas del navegador y genera las versiones que se
// pasan al OCR. El tratamiento de píxeles vive en receipt-pixels.ts.
export async function buildReceiptImageVariants(file: File): Promise<ReceiptImageVariant[]> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = receiptTargetSize(bitmap.width, bitmap.height)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    throw new Error('No se pudo preparar la imagen.')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const pixels = context.getImageData(0, 0, width, height)
  const variants = buildReceiptPixelVariants(pixels.data, width, height)
  return Promise.all(variants.map(async (variant) => ({ label: variant.label, source: await grayToBlob(variant.image) })))
}
