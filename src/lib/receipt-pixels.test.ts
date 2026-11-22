import { describe, expect, it } from 'vitest'
import { locateReceipt, prepareReceipt, warpReceipt, type GrayImage } from './receipt-pixels'

// Foto sintética: fondo oscuro con un "ticket" claro girado y una franja de "texto" oscuro.
function photo(angleDegrees: number): GrayImage {
  const width = 600, height = 800
  const data = new Uint8Array(width * height).fill(90)
  const angle = (angleDegrees * Math.PI) / 180
  const cx = 300, cy = 400, halfWidth = 170, halfHeight = 300
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x - cx) * Math.cos(angle) + (y - cy) * Math.sin(angle)
      const v = -(x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle)
      if (Math.abs(u) <= halfWidth && Math.abs(v) <= halfHeight) data[y * width + x] = Math.abs(v + 100) < 6 && Math.abs(u) < 120 ? 30 : 235
    }
  }
  return { data, width, height }
}

describe('recortar y enderezar el ticket', () => {
  it('encuentra las esquinas del ticket girado', () => {
    const quad = locateReceipt(photo(8))!
    expect(quad).not.toBeNull()
    // El ticket mide 340 × 600; con el margen, el recorte es algo mayor y nunca menor.
    const top = Math.hypot(quad.topRight.x - quad.topLeft.x, quad.topRight.y - quad.topLeft.y)
    const left = Math.hypot(quad.bottomLeft.x - quad.topLeft.x, quad.bottomLeft.y - quad.topLeft.y)
    expect(top).toBeGreaterThan(330)
    expect(top).toBeLessThan(420)
    expect(left).toBeGreaterThan(590)
    expect(left).toBeLessThan(680)
  })

  it('deja la línea de texto recta tras enderezar', () => {
    const image = photo(8)
    const flat = warpReceipt(image, locateReceipt(image)!, 400)
    // Filas con tinta: la franja oscura debe quedar en pocas filas seguidas (recta).
    const inkRows: number[] = []
    for (let y = 0; y < flat.height; y += 1) {
      let ink = 0
      for (let x = 0; x < flat.width; x += 1) if (flat.data[y * flat.width + x] < 80) ink += 1
      if (ink > flat.width * 0.3) inkRows.push(y)
    }
    expect(inkRows.length).toBeGreaterThan(0)
    expect(inkRows[inkRows.length - 1] - inkRows[0]).toBeLessThan(20)
  })

  it('no recorta si no hay fondo que quitar', () => {
    const blank: GrayImage = { data: new Uint8Array(300 * 400).fill(230), width: 300, height: 400 }
    expect(locateReceipt(blank)).toBeNull()
    expect(prepareReceipt(blank)).toBe(blank)
  })
})
