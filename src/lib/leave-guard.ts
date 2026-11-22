// Aviso de cambios sin guardar al salir de una pantalla (p. ej. una receta a medias).
// La pantalla con cambios registra un "guardián"; la navegación lo consulta antes
// de cambiar de sección y pregunta si guardar, salir sin guardar o seguir.
export type LeaveGuard = {
  // Qué se perdería, p. ej. «la receta «Lentejas»».
  what: string
  // Guarda los cambios; devuelve false si no se ha podido (p. ej. falta un dato).
  save?: () => Promise<boolean>
  // Texto del botón de guardar (por defecto «Guardar y salir»).
  saveLabel?: string
}

let current: LeaveGuard | null = null

export function setLeaveGuard(guard: LeaveGuard | null) {
  current = guard
}

export function getLeaveGuard() {
  return current
}
