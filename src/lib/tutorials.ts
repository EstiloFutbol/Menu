// Contenido de los tutoriales. Cada paso señala una parte de la pantalla, marcada en
// el código con data-tour="…". Si no se encuentra, el paso sale en el centro;
// los pasos `optional` se quitan si su parte no está (por ejemplo, una lista vacía).

export type TutorialSection = 'menu' | 'recetas' | 'compra' | 'despensa' | 'ajustes'

export type TutorialStep = {
  target?: string
  title: string
  text: string
  optional?: boolean
}

export type Tutorial = {
  title: string
  section: TutorialSection
  // Pestaña dentro de la sección (Compra → Ticket, Ajustes → Hogar…).
  tab?: string
  mode: 'completo' | 'sencillo' | 'ambos'
  steps: TutorialStep[]
}

const AYUDA = 'Puedes volver a verlo cuando quieras en Ajustes → Preferencias → Ayuda.'

export const TUTORIALS = {
  menu: {
    title: 'Menú', section: 'menu', mode: 'completo',
    steps: [
      { target: 'nav', title: 'Te damos la bienvenida a Menu', text: 'Desde aquí vas a cada sección: Menú, Recetas, Compra, Despensa y Ajustes. La primera vez que entres en cada una verás un tutorial corto como este.' },
      { target: 'menu-semana', title: 'Elige la semana', text: 'Con las flechas vas a la semana anterior o a la siguiente, y «Esta semana» te devuelve a hoy. «Copiar semana» copia todo lo planificado a otra semana.' },
      { target: 'menu-dias', title: 'Elige el día', text: 'Toca un día de la semana para ver sus comidas.', optional: true },
      { target: 'menu-comidas', title: 'Planifica cada comida', text: 'Pulsa una comida (desayuno, comida, cena…) para añadir recetas o productos, o márcala como «Comida fuera». Desde ahí puedes repetirlo en varias comidas o días a la vez.' },
      { target: 'menu-comidas', title: 'Cuando ya lo has comido', text: 'Pulsa «Completar» en la receta o el producto (en el ordenador, pulsa sobre él) para marcarlo como consumido: se descuenta de la despensa. Si te equivocas, «Deshacer» lo devuelve.' },
      { target: 'menu-resumen', title: 'Resumen de la semana', text: 'Lo que necesitas para lo que queda por comer esta semana, comparado con lo que tienes en la despensa.', optional: true },
      { title: 'Y después, la compra', text: `Con el menú hecho, ve a Compra y pulsa «Generar desde menú»: tendrás la lista con lo que te falta. ${AYUDA}` },
    ],
  },
  'menu-sencillo': {
    title: 'Menú (modo sencillo)', section: 'menu', mode: 'sencillo',
    steps: [
      { target: 'nav', title: 'Te damos la bienvenida a Menu', text: 'Estás en el modo sencillo: solo Menú, Compra y Ajustes. Si algún día quieres recetas, despensa y tickets, cambia al modo completo en Ajustes → Preferencias.' },
      { target: 'menu-semana', title: 'Elige la semana', text: 'Con las flechas cambias de semana. «Copiar a la siguiente» pasa lo escrito a la semana que viene, sin tocar los días que ya tengan texto.' },
      { target: 'menu-dia', title: 'Escribe el menú de cada día', text: 'Escribe lo que vais a comer, por ejemplo «Comida: lentejas. Cena: tortilla». Se guarda solo mientras escribes y todos en el hogar lo ven.' },
      { title: 'Listo', text: `Lo siguiente: en Compra tienes la lista de la compra. ${AYUDA}` },
    ],
  },
  recetas: {
    title: 'Recetas', section: 'recetas', mode: 'completo',
    steps: [
      { target: 'recetas-nueva', title: 'Crea tus recetas', text: 'Pon el nombre, las raciones, los ingredientes con su cantidad y los pasos. Si un ingrediente no existe, se añade solo al catálogo de productos.' },
      { target: 'recetas-importar', title: 'O impórtalas', text: 'Desde un Word (.docx), un PDF o texto pegado. Se lee en tu dispositivo y rellena el formulario para que lo revises antes de guardar.' },
      { target: 'recetas-buscar', title: 'Busca', text: 'Escribe parte del nombre para encontrar una receta.' },
      { target: 'recetas-lista', title: 'Tus recetas', text: 'Pulsa una para verla, editarla o borrarla. Para cocinarla, añádela a una comida en el Menú.', optional: true },
    ],
  },
  'compra-lista': {
    title: 'Compra: lista', section: 'compra', tab: 'lista', mode: 'completo',
    steps: [
      { target: 'compra-pestanas', title: 'Tres partes', text: 'Lista de la compra, Ticket (leer el ticket de lo que has comprado) e Historial de compras y precios.' },
      { target: 'compra-semana', title: 'Una lista por semana', text: 'Con las flechas cambias de semana.' },
      { target: 'compra-generar', title: 'Genera la lista desde el menú', text: 'Suma lo que necesitan las recetas y productos del menú y descuenta lo que ya tienes en la despensa. Si cambias el menú, vuelve a pulsarlo.' },
      { target: 'compra-manual', title: 'Añade lo que quieras', text: 'Para lo que no está en el menú: elige un producto o escribe uno nuevo.' },
      { target: 'compra-lista', title: 'En la tienda', text: 'Marca lo que vas comprando. Al terminar, «Añadir a despensa» suma lo marcado a tu despensa.', optional: true },
      { title: 'Y luego, el ticket', text: `En la pestaña Ticket puedes leer el ticket de la compra para guardar los precios y llenar la despensa de una vez. ${AYUDA}` },
    ],
  },
  'compra-ticket': {
    title: 'Compra: ticket', section: 'compra', tab: 'ticket', mode: 'completo',
    steps: [
      { target: 'ticket-subir', title: 'Lee el ticket', text: 'Haz una foto al ticket o elige un PDF (por ejemplo, el ticket digital de Mercadona). Se lee en tu dispositivo: la foto no se guarda ni se envía a ningún sitio.' },
      { target: 'ticket-pasos', title: 'Revisa y confirma', text: 'Después revisas cada línea (qué producto es, cantidad y precio) y decides qué entra en la despensa.' },
      { target: 'ticket-traducciones', title: 'La app aprende', text: 'Recuerda cómo traduces cada concepto del ticket («LECHE S/LACT» → Leche sin lactosa) para la próxima vez. Aquí puedes cambiarlas o borrarlas.' },
    ],
  },
  'compra-historial': {
    title: 'Compra: historial', section: 'compra', tab: 'historial', mode: 'completo',
    steps: [
      { target: 'historial-lista', title: 'Tus compras', text: 'Cada ticket que importas, con sus productos y precios. Puedes abrir uno para verlo, editarlo o eliminarlo; al eliminarlo se resta de la despensa lo que había sumado.' },
    ],
  },
  'compra-sencilla': {
    title: 'Compra (modo sencillo)', section: 'compra', mode: 'sencillo',
    steps: [
      { target: 'lista-anadir', title: 'Apunta lo que falta', text: 'Escribe y pulsa Añadir. Puedes pegar una lista entera: se añade una cosa por línea.' },
      { target: 'lista-items', title: 'En la tienda', text: 'Marca lo que compras y ordénalo con las flechas. «Quitar lo comprado» limpia la lista.', optional: true },
      { title: 'Compartida', text: `Todos en el hogar ven la misma lista y lo que marca cada uno, al momento. ${AYUDA}` },
    ],
  },
  despensa: {
    title: 'Despensa', section: 'despensa', tab: 'stock', mode: 'completo',
    steps: [
      { target: 'despensa-pestanas', title: 'Dos partes', text: 'Existencias: lo que tienes en casa. Productos: el catálogo de todo lo que usas en recetas, menú y compras.' },
      { target: 'despensa-anadir', title: 'Añade lo que tienes', text: 'Con cantidad (500 g, 6 unidades) o solo con un estado: Tengo, Queda poco o No tengo.' },
      { target: 'despensa-buscar', title: 'Busca', text: 'Por nombre o categoría.' },
      { target: 'despensa-lista', title: 'Se actualiza sola', text: 'Pulsa un producto para cambiarlo. Además, baja al consumir del menú y sube al importar tickets o añadir la compra.', optional: true },
    ],
  },
  'despensa-productos': {
    title: 'Despensa: productos', section: 'despensa', tab: 'products', mode: 'completo',
    steps: [
      { target: 'productos-nuevo', title: 'Tu catálogo', text: 'Todos los productos que usas. Crea uno nuevo con su categoría y su unidad habitual.' },
      { target: 'productos-basicos', title: 'Productos básicos', text: 'Añade de una vez los productos más comunes (sin repetir los que ya tienes).' },
      { target: 'productos-buscar', title: 'Busca', text: 'Por nombre, categoría o unidad.' },
      { target: 'productos-lista', title: 'Ordena tu catálogo', text: 'Lápiz para editar. Si tienes dos iguales, fusiónalos: todo pasa a uno. Solo se pueden borrar los que no se han usado nunca.', optional: true },
    ],
  },
  'ajustes-cuenta': {
    title: 'Ajustes: cuenta', section: 'ajustes', tab: 'cuenta', mode: 'ambos',
    steps: [
      { target: 'ajustes-pestanas', title: 'Ajustes', text: 'Cuenta (tu sesión y tus datos), Hogar (con quién compartes) y Preferencias (modo de la app, planificación y ayuda).' },
      { target: 'cuenta-copia', title: 'Copia de seguridad', text: 'Descarga un archivo con todos los datos del hogar que estás viendo. No se sube a ningún sitio.' },
      { target: 'cuenta-sobre', title: 'Novedades', text: 'La versión de la app, lo nuevo de cada versión y el botón para buscar actualizaciones.' },
    ],
  },
  'ajustes-hogar': {
    title: 'Ajustes: hogar', section: 'ajustes', tab: 'hogar', mode: 'ambos',
    steps: [
      { target: 'hogar-actual', title: 'Tu hogar', text: 'Todo lo de la app es del hogar que estás viendo. Aquí ves quién está en él.' },
      { target: 'hogar-invitar', title: 'Invita', text: 'A tu hogar, para compartir menú, recetas, compra y despensa, o solo a la app, para que tenga su propio hogar.' },
      { target: 'hogar-unirse', title: 'Únete a otro hogar', text: 'Con el código que te den. Tus datos no se pierden: siguen en tu hogar personal y puedes volver a él cuando quieras.' },
    ],
  },
  'ajustes-preferencias': {
    title: 'Ajustes: preferencias', section: 'ajustes', tab: 'preferencias', mode: 'ambos',
    steps: [
      { target: 'pref-modo', title: 'Modo de la app', text: 'Completo, con recetas, despensa y tickets, o sencillo: un texto por día y una lista escrita a mano. Puedes cambiar cuando quieras sin perder nada.' },
      { target: 'pref-planificacion', title: 'Planificación', text: 'Raciones por defecto, en qué día empieza la semana y qué comidas se muestran en el menú.' },
      { target: 'pref-ayuda', title: 'Ayuda', text: 'Aquí puedes volver a ver cualquier tutorial.' },
    ],
  },
} satisfies Record<string, Tutorial>

export type TutorialId = keyof typeof TUTORIALS

export const TUTORIAL_IDS = Object.keys(TUTORIALS) as TutorialId[]

// Tutoriales que se ofrecen en Ayuda según el modo del hogar.
export function tutorialsForMode(mode: 'completo' | 'sencillo'): TutorialId[] {
  return TUTORIAL_IDS.filter((id) => {
    const tutorial: Tutorial = TUTORIALS[id]
    return tutorial.mode === 'ambos' || tutorial.mode === mode
  })
}
