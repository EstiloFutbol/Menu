import { describe, expect, it } from 'vitest'
import docxBase64 from './__fixtures__/receta-tres-hermanas.docx.b64?raw'
import { extractDocxText } from './recipe-docx'
import { guessCategory, matchCatalogName, parseRecipeText } from './recipe-import'

// Documento real de una receta para Thermomix (solo su texto, en base64).
async function docxFixture() {
  const bytes = Uint8Array.from(atob(docxBase64.replace(/\s/g, '')), (char) => char.charCodeAt(0))
  return extractDocxText(bytes.buffer)
}

describe('importar una receta desde un .docx', () => {
  it('saca el texto con las filas de la tabla en una línea', async () => {
    const text = await docxFixture()
    expect(text.split('\n')[0]).toBe('LAS TRES HERMANAS')
    expect(text).toContain('Ajo\t2 dientes')
  })

  it('lee nombre, raciones, ingredientes, pasos y notas', async () => {
    const recipe = parseRecipeText(await docxFixture())
    expect(recipe.name).toBe('Las tres hermanas')
    expect(recipe.servings).toBe(2)
    expect(recipe.ingredients).toHaveLength(14)
    expect(recipe.ingredients[0]).toEqual({ name: 'Alubias blancas cocidas', quantity: 400, unit: 'g', notes: 'escurridas' })
    expect(recipe.ingredients[1]).toEqual({ name: 'Calabaza', quantity: 300, unit: 'g', notes: 'pelada, en dados de 2 cm' })
    expect(recipe.ingredients.find((item) => item.name === 'Ajo')).toEqual({ name: 'Ajo', quantity: 2, unit: 'unidad', notes: '2 dientes' })
    expect(recipe.ingredients.find((item) => item.name === 'Comino molido')).toMatchObject({ quantity: 0.5, unit: 'cucharadita' })
    // El aceite pesado en gramos se pasa a mililitros, que es como se compra.
    expect(recipe.ingredients.find((item) => item.name.startsWith('Aceite'))).toMatchObject({ quantity: 22, unit: 'ml', notes: '20 g' })
    // "10 g de perejil por ración" con 2 raciones son 20 g.
    expect(recipe.ingredients.find((item) => item.name === 'Perejil fresco')).toMatchObject({ quantity: 20, unit: 'g' })
    expect(recipe.unread).toEqual(['Sal y pimienta: Al gusto'])
    expect(recipe.steps).toHaveLength(5)
    expect(recipe.steps[1]).toBe('Sofreír. Añade el aceite. Programa 10 minutos / 120 °C / velocidad 1.')
    expect(recipe.description).toContain('Congelación y servicio:\n- Enfría rápidamente')
  })
})

describe('importar una receta desde texto pegado', () => {
  const text = `# Lentejas con verduras
Receta de diario. Para 4 personas. Tiempo: 1 h

## Ingredientes
- 300 g de lentejas pardinas
- 2 zanahorias
- 1 cebolla picada
- 1/2 cucharadita de pimentón
- Sal: c/s

## Elaboración
Pon las lentejas en remojo la noche anterior y
escúrrelas.
2) Sofríe la cebolla y la zanahoria.
3) Añade las lentejas, cubre de agua y cuece 40 minutos.`

  it('entiende cantidades delante, fracciones y unidades sueltas', () => {
    const recipe = parseRecipeText(text)
    expect(recipe.name).toBe('Lentejas con verduras')
    expect(recipe.servings).toBe(4)
    expect(recipe.preparationMinutes).toBe(60)
    expect(recipe.ingredients).toEqual([
      { name: 'Lentejas pardinas', quantity: 300, unit: 'g', notes: '' },
      { name: 'Zanahorias', quantity: 2, unit: 'unidad', notes: '' },
      { name: 'Cebolla', quantity: 1, unit: 'unidad', notes: 'picada' },
      { name: 'Pimentón', quantity: 0.5, unit: 'cucharadita', notes: '' },
    ])
    expect(recipe.unread).toEqual(['Sal: c/s'])
  })

  it('junta las líneas cortadas de un mismo paso', () => {
    expect(parseRecipeText(text).steps).toEqual([
      'Pon las lentejas en remojo la noche anterior y escúrrelas.',
      'Sofríe la cebolla y la zanahoria.',
      'Añade las lentejas, cubre de agua y cuece 40 minutos.',
    ])
  })
})

describe('catálogo y categorías', () => {
  const catalog = [{ name: 'Tomate' }, { name: 'Alubias blancas cocidas' }, { name: 'Pimiento' }]

  it('reutiliza el alimento del catálogo aunque el nombre traiga más detalle', () => {
    expect(matchCatalogName('tomate', catalog)).toEqual({ item: catalog[0], extra: '' })
    expect(matchCatalogName('Pimiento rojo', catalog)).toEqual({ item: catalog[2], extra: 'rojo' })
    expect(matchCatalogName('Tomatera', catalog)).toBeNull()
  })

  it('propone la categoría de compra de un alimento nuevo', () => {
    expect(guessCategory('Lomo de salmón')).toBe('Pescado y marisco')
    expect(guessCategory('Zumo de limón')).toBe('Fruta y verdura')
    expect(guessCategory('Sal')).toBe('Salsas y condimentos')
    expect(guessCategory('Quinoa roja')).toBe('Despensa')
    expect(guessCategory('Cosa rara')).toBe('Otros')
  })
})
