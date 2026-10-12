// Convierte errores de Supabase/Postgres en mensajes para el usuario, sin mostrar
// detalles internos (nombres de tablas, restricciones o SQL).

type ErrorOverrides = {
  // Mensaje cuando el registro está en uso en otra tabla (clave foránea).
  inUse?: string
  // Mensaje cuando ya existe un registro igual (restricción única).
  duplicate?: string
}

// Mensajes que lanzan nuestras funciones SQL, traducidos.
const knownMessages: Record<string, string> = {
  'Authentication required': 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  'Ingredient not found': 'No se ha encontrado el producto.',
  'Ingredient does not belong to current user': 'No se ha encontrado el producto.',
  'Invalid product': 'Alguno de los productos ya no existe.',
  'Invalid recipe': 'Alguna de las recetas ya no existe.',
  'Nothing to add': 'No hay nada que añadir.',
  'Planned recipe not found': 'Esa receta ya no está en el menú.',
  'Planned product not found': 'Ese producto ya no está en el menú.',
  'This planned recipe has already been completed': 'Esta planificación ya estaba completada. No se ha descontado nada de nuevo.',
  'This planned product has already been completed': 'Este producto ya estaba completado. No se ha descontado nada de nuevo.',
  'Purchase not found': 'No se ha encontrado el ticket.',
  'Purchase item not found': 'No se ha encontrado la línea del ticket.',
  'Store name is required': 'Indica la tienda.',
  'Invalid total amount': 'El total del ticket no es válido.',
  'Product names are required': 'Todas las líneas necesitan un producto.',
  'Product price cannot be negative': 'El precio no puede ser negativo.',
  'Product quantity must be greater than zero': 'La cantidad debe ser mayor que cero.',
  'Quantity must be greater than zero': 'La cantidad debe ser mayor que cero.',
  'Servings must be greater than zero': 'Las raciones deben ser mayores que cero.',
  'Ingredient quantity cannot be negative': 'La cantidad no puede ser negativa.',
}

function errorParts(cause: unknown): { message: string; code: string | null } {
  if (cause && typeof cause === 'object') {
    const value = cause as { message?: unknown; code?: unknown }
    return { message: typeof value.message === 'string' ? value.message : '', code: typeof value.code === 'string' ? value.code : null }
  }
  return { message: typeof cause === 'string' ? cause : '', code: null }
}

export function friendlyError(cause: unknown, fallback: string, overrides: ErrorOverrides = {}): string {
  const { message, code } = errorParts(cause)
  if (!message && !code) return fallback

  if (knownMessages[message]) return knownMessages[message]
  if (message.startsWith('Incompatible pantry unit')) return 'La unidad no es compatible con la que tienes en despensa.'
  if (code === '23503') return overrides.inUse ?? 'No se puede completar porque está en uso en otra parte de la app.'
  if (code === '23505') return overrides.duplicate ?? 'Ya existe un elemento igual.'
  if (code === '42501' || /row-level security/i.test(message)) return 'No tienes permiso para hacer esto.'
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'No hay conexión. Comprueba tu red e inténtalo de nuevo.'

  // Errores de Postgres no previstos (tienen código SQLSTATE o hablan de restricciones): mensaje genérico.
  if (code || /constraint|violates|relation|column|syntax/i.test(message)) return fallback

  // El resto son mensajes propios, ya pensados para el usuario (por ejemplo los de validación).
  return message
}
