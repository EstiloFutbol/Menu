import { normalizeReceiptName } from './receipt'

// Lee una receta escrita a mano o generada (un .docx, un PDF o texto pegado) y la
// convierte en los campos del formulario de receta. Todo se hace en el propio
// dispositivo. Lo que no se entiende se devuelve aparte para revisarlo.

export type RecipeUnit = 'g' | 'kg' | 'ml' | 'l' | 'unidad' | 'cucharada' | 'cucharadita' | 'taza' | 'lata' | 'paquete'

export type ImportedIngredient = { name: string; quantity: number; unit: RecipeUnit; notes: string }

export type ImportedRecipe = {
  name: string
  description: string
  servings: number | null
  preparationMinutes: number | null
  ingredients: ImportedIngredient[]
  steps: string[]
  // Líneas de ingredientes que no se han podido leer (p. ej. "Sal y pimienta: al gusto").
  unread: string[]
}

const fractions: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 }
const quantity = String.raw`(?:\d+\s*[½¼¾⅓⅔]|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔])`

// Palabra de unidad → unidad de la app (y factor, para cl y dl).
const unitWords: Array<[RegExp, RecipeUnit, number?]> = [
  [/^(g|gr|grs|gramos?)$/, 'g'],
  [/^(kg|kgs|kilos?|kilogramos?)$/, 'kg'],
  [/^(ml|mililitros?|cc)$/, 'ml'],
  [/^(cl|centilitros?)$/, 'ml', 10],
  [/^(dl|decilitros?)$/, 'ml', 100],
  [/^(l|lt|litros?)$/, 'l'],
  [/^(cucharaditas?|cdtas?|cditas?|cucharadita)$/, 'cucharadita'],
  [/^(cucharadas?|cdas?)$/, 'cucharada'],
  [/^(tazas?|vasos?)$/, 'taza'],
  [/^(latas?|botes?)$/, 'lata'],
  [/^(paquetes?|sobres?|bolsas?|tarrinas?)$/, 'paquete'],
  [/^(unidades?|uds?|u|piezas?)$/, 'unidad'],
  // Se cuentan por unidades, pero se conserva la palabra en la nota ("2 dientes").
  [/^(dientes?|hojas?|ramas?|ramitas?|rodajas?|lonchas?|filetes?|pizcas?|puñados?|manojos?)$/, 'unidad'],
]

const round = (value: number) => Math.round(value * 100) / 100

function parseQuantity(text: string) {
  const value = text.replace(/\s+/g, '')
  const mixed = value.match(/^(\d+)([½¼¾⅓⅔])$/)
  if (mixed) return Number(mixed[1]) + fractions[mixed[2]]
  if (fractions[value] != null) return fractions[value]
  const ratio = value.match(/^(\d+)\/(\d+)$/)
  if (ratio) return Number(ratio[2]) ? Number(ratio[1]) / Number(ratio[2]) : null
  const number = Number(value.replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

const plain = (word: string) => word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.$/, '')

// "400 g", "½ cucharadita", "2 dientes", "120–150 g" → cantidad, unidad y nota.
// Devuelve el resto del texto (lo que va detrás de la unidad) en `rest`.
function parseAmount(text: string): { quantity: number; unit: RecipeUnit; note: string; rest: string } | null {
  const match = text.trim().match(new RegExp(String.raw`^(${quantity})(?:\s*[-–]\s*(${quantity}))?\s*([\p{L}.\/]+)?\s*(.*)$`, 'u'))
  if (!match) return null
  const first = parseQuantity(match[1])
  if (first == null || first <= 0) return null
  const word = match[3] ?? ''
  const known = word ? unitWords.find(([pattern]) => pattern.test(plain(word))) : undefined
  const unit = known?.[1] ?? 'unidad'
  const factor = known?.[2] ?? 1
  const rest = (known ? match[4] : `${word} ${match[4]}`).trim()
  const notes: string[] = []
  if (match[2]) notes.push(`${match[1]}–${match[2]} ${word}`.trim())
  else if (known && unit === 'unidad' && !/^(unidades?|uds?|u|piezas?)$/.test(plain(word))) notes.push(`${match[1]} ${word}`)
  return { quantity: round(first * factor), unit, note: notes.join(', '), rest }
}

const cleanLine = (line: string) => line
  .replace(/\*\*|__|`/g, '')
  .replace(/^#{1,6}\s+/, '')
  .replace(/^[-•*·▪◦]\s+/, '')
  .replace(/\s+$/, '')
  .trim()

// "Calabaza pelada, en dados de 2 cm" → nombre "Calabaza pelada", nota "en dados de 2 cm".
function splitName(text: string) {
  let name = text.trim().replace(/[.:;]+$/, '')
  const notes: string[] = []
  const parenthesis = name.match(/\s*\(([^)]*)\)\s*/)
  if (parenthesis) { notes.push(parenthesis[1].trim()); name = name.replace(parenthesis[0], ' ').trim() }
  const comma = name.indexOf(',')
  if (comma > 0) { notes.unshift(name.slice(comma + 1).trim()); name = name.slice(0, comma).trim() }
  // Cómo se prepara no forma parte del producto: "Tomate maduro", "Maíz dulce cocido y escurrido".
  const preparation = name.match(new RegExp(String.raw`\s+((?:(?:y|o)\s+)?(?:${preparationWords})(?:\s+(?:y|o)\s+(?:${preparationWords}))*)$`, 'i'))
  if (preparation) { notes.unshift(preparation[1].replace(/^(y|o)\s+/i, '')); name = name.slice(0, preparation.index).trim() }
  // Alternativas: "Agua mineral o filtrada" → "Agua mineral", nota "o filtrada".
  const alternative = name.match(/\s+(o\s+\S+)$/i)
  if (alternative) { notes.unshift(alternative[1]); name = name.slice(0, alternative.index).trim() }
  return { name: name.replace(/^de\s+/i, '').trim(), notes }
}

const preparationWords = String.raw`(?:pelad|picad|escurrid|madur|trocead|rallad|lavad|cortad|laminad|deshuesad|desgranad|machacad|triturad|templad)[oa]s?`

const sectionPatterns = {
  ingredients: /^ingredientes\b/i,
  steps: /^(preparaci[oó]n|elaboraci[oó]n|pasos|instrucciones|procedimiento|modo de (preparaci[oó]n|hacerlo))\b/i,
  notes: /^(congelaci[oó]n|conservaci[oó]n|notas?|consejos?|trucos?|variantes?|observaciones|emplatado|informaci[oó]n nutricional|valores nutricionales|para servir)\b/i,
}

function headingOf(line: string): keyof typeof sectionPatterns | null {
  if (line.length > 60 || /\t/.test(line) || /[.;]$/.test(line)) return null
  for (const [section, pattern] of Object.entries(sectionPatterns) as Array<[keyof typeof sectionPatterns, RegExp]>) {
    if (pattern.test(line)) return section
  }
  return null
}

// "LAS TRES HERMANAS" → "Las tres hermanas"
function sentenceCase(text: string) {
  if (text !== text.toUpperCase()) return text
  const lower = text.toLocaleLowerCase('es')
  return lower.charAt(0).toLocaleUpperCase('es') + lower.slice(1)
}

export function findServings(text: string) {
  const match = text.match(/(\d+)\s+raci[oó]n(?:es)?\b|para\s+(\d+)\s+personas?\b|(\d+)\s+personas\b|raciones\s*:?\s*(\d+)/i)
  const value = match ? Number(match[1] ?? match[2] ?? match[3] ?? match[4]) : null
  return value && value > 0 && value < 100 ? value : null
}

function findMinutes(text: string) {
  const match = text.match(/(?:tiempo|duraci[oó]n)[^\d\n]{0,25}(\d+)\s*(h|horas?|min|minutos?)\b/i)
  if (!match) return null
  return /^h/i.test(match[2]) ? Number(match[1]) * 60 : Number(match[1])
}

// Una línea de ingredientes. Puede traer varios: "Para servir: 10 g de perejil y 10 ml de zumo de limón por ración".
function parseIngredientLine(line: string, servings: number | null): ImportedIngredient[] | null {
  // Tabla: "Cebolla<TAB>100 g".
  if (line.includes('\t')) {
    const [nameText, ...amountParts] = line.split('\t').map((part) => part.trim()).filter(Boolean)
    if (!nameText || !amountParts.length) return null
    return parseIngredientLine(`${nameText}: ${amountParts.join(' ')}`, servings)
  }

  // Etiqueta delante ("Para servir (no congelar): …") y varios ingredientes separados por "," o "y".
  let label = ''
  let body = line.replace(/\.$/, '')
  const labelled = body.match(/^([^:\d]{3,60}):\s*(.+)$/)
  if (labelled && new RegExp(`^${quantity}`).test(labelled[2].trim())) {
    // "Cebolla: 100 g": lo de delante de los dos puntos es el nombre, no una etiqueta.
    const only = parseAmount(labelled[2])
    if (only && !only.rest) body = `${labelled[2].trim()} ${labelled[1].trim()}`
    else { label = labelled[1].trim(); body = labelled[2] }
  }
  const perServing = /\s+por\s+raci[oó]n$/i.test(body) || /\s+por\s+persona$/i.test(body)
  body = body.replace(/\s+por\s+(raci[oó]n|persona)$/i, '')
  const parts = body.split(new RegExp(String.raw`\s*(?:,|\sy\s)\s*(?=${quantity}\s)`))

  const result: ImportedIngredient[] = []
  for (const part of parts) {
    // Cantidad delante ("400 g de alubias", "2 dientes de ajo") o detrás ("Cebolla 100 g", "Cebolla: 100 g").
    const front = parseAmount(part)
    const back = front ? null : part.match(new RegExp(String.raw`^(.+?)[:\s]+(${quantity}(?:\s*[-–]\s*${quantity})?\s*[\p{L}.]*)$`, 'u'))
    const amount = front ?? (back ? parseAmount(back[2]) : null)
    const nameText = front ? front.rest : back?.[1] ?? ''
    if (!amount || !/\p{L}{2}/u.test(nameText)) return null
    const { name, notes } = splitName(nameText)
    // El aceite se pesa en muchas recetas (Thermomix), pero se compra y se guarda en volumen.
    if (/^aceite\b/i.test(name) && amount.unit === 'g') {
      amount.note = [amount.note, `${amount.quantity} g`].filter(Boolean).join(', ')
      amount.quantity = Math.round(amount.quantity / 0.92)
      amount.unit = 'ml'
    }
    const scale = perServing && servings ? servings : 1
    const extra = perServing ? [`${round(amount.quantity)} ${amount.unit} por ración`] : []
    result.push({
      name: name.charAt(0).toLocaleUpperCase('es') + name.slice(1),
      quantity: round(amount.quantity * scale),
      unit: amount.unit,
      notes: [label, ...extra, amount.note, ...notes].filter(Boolean).join(', '),
    })
  }
  return result.length ? result : null
}

export function parseRecipeText(text: string): ImportedRecipe {
  const lines = text.split(/\r?\n/).map(cleanLine).filter((line) => line && !/^!\[|^fotograf[ií]a\b/i.test(line))
  const servings = findServings(text)
  const recipe: ImportedRecipe = { name: '', description: '', servings, preparationMinutes: findMinutes(text), ingredients: [], steps: [], unread: [] }
  const header: string[] = []
  const notes: string[] = []
  let section: 'header' | keyof typeof sectionPatterns = 'header'

  for (const line of lines) {
    const heading = headingOf(line)
    if (heading) {
      section = heading
      if (heading === 'notes') notes.push(`\n${line.replace(/:$/, '')}:`)
      continue
    }
    if (section === 'header') {
      if (!recipe.name) recipe.name = sentenceCase(line.replace(/^receta:?\s*/i, ''))
      else header.push(line)
    } else if (section === 'ingredients') {
      const parsed = parseIngredientLine(line, servings)
      if (parsed) recipe.ingredients.push(...parsed)
      else recipe.unread.push(line.replace(/\t+/g, ': '))
    } else if (section === 'steps') {
      const numbered = line.match(/^(?:paso\s*)?\d{1,2}\s*[.)\-:]\s*(.+)$/i)
      const last = recipe.steps.length - 1
      // Una línea sin número que sigue a un paso sin terminar es su continuación (texto pegado con saltos).
      if (!numbered && last >= 0 && !/[.!?:)]$/.test(recipe.steps[last])) recipe.steps[last] = `${recipe.steps[last]} ${line}`
      else recipe.steps.push(numbered ? numbered[1].trim() : line)
    } else {
      notes.push(`- ${line}`)
    }
  }

  recipe.description = [header.join('\n'), notes.join('\n').trim()].filter(Boolean).join('\n\n')
  return recipe
}

// Categoría de compra probable de un alimento nuevo, por palabras clave.
const categoryKeywords: Array<[string, string[]]> = [
  ['Pescado y marisco', ['salmon', 'merluza', 'atun', 'bacalao', 'gamba', 'langostino', 'mejillon', 'sardina', 'calamar', 'pulpo', 'pescado', 'dorada', 'lubina', 'boqueron', 'anchoa', 'surimi']],
  ['Carne', ['pollo', 'ternera', 'cerdo', 'jamon', 'pavo', 'carne', 'chorizo', 'bacon', 'beicon', 'conejo', 'cordero', 'salchicha', 'lomo', 'solomillo', 'pechuga', 'muslo', 'hamburguesa']],
  ['Lácteos y huevos', ['leche', 'queso', 'yogur', 'nata', 'mantequilla', 'huevo', 'burrata', 'mozzarella', 'kefir', 'requeson']],
  ['Fruta y verdura', ['calabaza', 'cebolla', 'ajo', 'pimiento', 'tomate', 'judias verdes', 'perejil', 'limon', 'lima', 'zanahoria', 'patata', 'lechuga', 'espinaca', 'calabacin', 'berenjena', 'pepino', 'puerro', 'apio', 'champinon', 'seta', 'manzana', 'platano', 'naranja', 'fresa', 'aguacate', 'cilantro', 'albahaca', 'brocoli', 'coliflor', 'jengibre', 'menta', 'cebollino', 'rucula', 'col', 'boniato', 'uva', 'pera', 'kiwi', 'mango', 'pina']],
  ['Panadería', ['pan', 'baguette', 'chapata', 'tostada', 'picatoste']],
  ['Bebidas', ['agua', 'vino', 'cerveza', 'zumo', 'refresco']],
  ['Salsas y condimentos', ['sal', 'pimienta', 'comino', 'oregano', 'pimenton', 'canela', 'curry', 'curcuma', 'tomillo', 'romero', 'laurel', 'especia', 'salsa', 'vinagre', 'mostaza', 'mayonesa', 'ketchup', 'nuez moscada', 'clavo', 'azafran', 'soja']],
  ['Despensa', ['aceite', 'arroz', 'pasta', 'alubia', 'garbanzo', 'lenteja', 'maiz', 'harina', 'azucar', 'caldo', 'quinoa', 'avena', 'fideo', 'macarron', 'espagueti', 'tomate frito', 'conserva', 'levadura', 'miel', 'frutos secos', 'almendra', 'nuez']],
]

export function guessCategory(name: string) {
  const text = ` ${normalizeReceiptName(name)} `
  const found = categoryKeywords.find(([, words]) => words.some((word) => new RegExp(`\\s${word}(?:s|es)?\\s`).test(text)))
  return found?.[0] ?? 'Otros'
}

// Busca el alimento en el catálogo: igual (sin tildes ni mayúsculas) o el nombre
// más largo del catálogo con el que empieza ("Tomate maduro" → "Tomate", nota "maduro").
export function matchCatalogName<T extends { name: string }>(name: string, catalog: T[]): { item: T; extra: string } | null {
  const target = normalizeReceiptName(name)
  let best: { item: T; extra: string; length: number } | null = null
  for (const item of catalog) {
    const candidate = normalizeReceiptName(item.name)
    if (!candidate) continue
    if (candidate === target) return { item, extra: '' }
    if (candidate.length >= 3 && target.startsWith(`${candidate} `) && (!best || candidate.length > best.length)) {
      const words = name.trim().split(/\s+/)
      const extra = words.slice(candidate.split(' ').length).join(' ').replace(/^(y|de|del|con)\s+/i, '')
      best = { item, extra, length: candidate.length }
    }
  }
  return best ? { item: best.item, extra: best.extra } : null
}
