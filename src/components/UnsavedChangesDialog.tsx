import { useState } from 'react'
import type { LeaveGuard } from '../lib/leave-guard'

// Pregunta qué hacer con los cambios sin guardar antes de salir de una pantalla.
export function UnsavedChangesDialog({ guard, onLeave, onStay }: { guard: LeaveGuard; onLeave: () => void; onStay: () => void }) {
  const [saving, setSaving] = useState(false)

  async function saveAndLeave() {
    if (!guard.save) return
    setSaving(true)
    const saved = await guard.save()
    setSaving(false)
    // Si no se ha podido guardar, se vuelve a la pantalla para ver el motivo.
    if (saved) onLeave()
    else onStay()
  }

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="unsaved-title" onMouseDown={(event) => event.target === event.currentTarget && !saving && onStay()}>
    <div className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-3xl sm:p-6">
      <h2 id="unsaved-title" className="text-lg font-semibold tracking-tight">¿Guardar los cambios?</h2>
      <p className="mt-2 text-sm text-neutral-600">Tienes cambios sin guardar en {guard.what}. Si sales sin guardar, se perderán.</p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
        {guard.save && <button type="button" disabled={saving} onClick={() => void saveAndLeave()} className="rounded-2xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Guardando…' : guard.saveLabel ?? 'Guardar y salir'}</button>}
        <button type="button" disabled={saving} onClick={onLeave} className="rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">Salir sin guardar</button>
        <button type="button" disabled={saving} onClick={onStay} className="rounded-2xl px-4 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 sm:mr-auto">Seguir editando</button>
      </div>
    </div>
  </div>
}
