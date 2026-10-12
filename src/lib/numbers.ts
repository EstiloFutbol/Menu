// Reglas de los campos numéricos de la app. Todos aceptan coma o punto como
// separador decimal y se guardan internamente con punto.
export type NumberKind = 'quantity' | 'servings' | 'money' | 'referencePrice' | 'minutes' | 'packages' | 'nutrition'

type NumberRule = { decimals: number; min: number; allowMin: boolean }

export const numberRules: Record<NumberKind, NumberRule> = {
  quantity: { decimals: 2, min: 0, allowMin: false },
  servings: { decimals: 2, min: 0, allowMin: false },
  money: { decimals: 2, min: 0, allowMin: true },
  referencePrice: { decimals: 3, min: 0, allowMin: true },
  minutes: { decimals: 0, min: 0, allowMin: true },
  packages: { decimals: 0, min: 0, allowMin: false },
  nutrition: { decimals: 1, min: 0, allowMin: true },
}

// Limpia lo que se escribe: coma por punto, solo dígitos y un separador, y como
// mucho los decimales permitidos. No redondea: corta lo que sobra al teclear.
export function sanitizeNumberInput(raw: string, decimals: number) {
  const cleaned = raw.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  if (decimals === 0 || rest.length === 0) return decimals === 0 ? whole : cleaned
  return `${whole}.${rest.join('').slice(0, decimals)}`
}

// null si está vacío o no es un número.
export function parseNumberInput(value: string) {
  const normalized = value.trim().replace(/,/g, '.')
  if (!normalized || normalized === '.') return null
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

// Mensaje de error para un valor fuera de rango, o null si es válido o está vacío
// (que un campo sea obligatorio lo decide cada formulario con `required`).
// `allowZero` permite 0 en campos que normalmente exigen más (la despensa, por ejemplo).
export function numberInputError(value: string, kind: NumberKind, allowZero = false) {
  if (!value.trim()) return null
  const parsed = parseNumberInput(value)
  if (parsed === null) return 'Introduce un número válido.'
  const rule = numberRules[kind]
  if (rule.allowMin || allowZero) return parsed < rule.min ? 'No puede ser negativo.' : null
  return parsed <= rule.min ? 'Debe ser mayor que 0.' : null
}

// Valor inicial de un campo a partir de un número calculado (por ejemplo, una
// cantidad escalada por raciones), redondeado a los decimales del campo.
export function numberToInputValue(value: number | null | undefined, kind: NumberKind) {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  const factor = 10 ** numberRules[kind].decimals
  return String(Math.round(value * factor) / factor)
}
