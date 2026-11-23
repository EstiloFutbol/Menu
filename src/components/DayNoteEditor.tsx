import { useEffect, useRef, useState } from 'react'
import { friendlyError } from '../lib/errors'
import { DAY_NOTE_MAX } from '../lib/simple'
import { supabase } from '../lib/supabase'

type Status = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

const SAVE_DELAY_MS = 600

// Texto del menú sencillo para un día. Se guarda solo, poco después de dejar de escribir,
// al salir del cuadro y al cerrar la pantalla. Si alguien del hogar lo cambia, se ve
// al recargar, salvo mientras lo estás escribiendo tú.
export function DayNoteEditor({ day, serverText, label, placeholder, compact = false, onSaved }: {
  day: string
  serverText: string
  label: string
  placeholder?: string
  compact?: boolean
  onSaved?: (day: string, text: string) => void
}) {
  const [text, setText] = useState(serverText)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')
  const timer = useRef<number | null>(null)
  const latest = useRef({ text: serverText, saved: serverText, day })
  const area = useRef<HTMLTextAreaElement>(null)

  // Lo guardado por otros se refleja si no hay cambios propios sin guardar.
  useEffect(() => {
    if (latest.current.text === latest.current.saved) { setText(serverText); latest.current = { ...latest.current, text: serverText } }
    latest.current.saved = serverText
  }, [serverText])

  // El cuadro crece con el texto.
  useEffect(() => {
    const element = area.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight + 2}px`
  }, [text])

  async function save() {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null }
    const { text: value, saved, day: noteDay } = latest.current
    if (!supabase || value === saved) return
    setStatus('saving'); setError('')
    const { error: saveError } = await supabase.from('menu_day_notes').upsert({ day: noteDay, text: value }, { onConflict: 'household_id,day' })
    if (saveError) { setStatus('error'); setError(friendlyError(saveError, 'No se ha podido guardar. Se volverá a intentar al seguir escribiendo.')); return }
    latest.current.saved = value
    onSaved?.(noteDay, value)
    setStatus(latest.current.text === value ? 'saved' : 'pending')
  }

  // Al cerrar la pantalla se guarda lo pendiente.
  useEffect(() => () => { void save() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function change(value: string) {
    const next = value.slice(0, DAY_NOTE_MAX)
    setText(next)
    latest.current.text = next
    setStatus('pending')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { void save() }, SAVE_DELAY_MS)
  }

  const statusText = status === 'pending' || status === 'saving' ? 'Guardando…' : status === 'saved' ? 'Guardado' : ''
  return <div>
    <textarea
      ref={area}
      aria-label={label}
      value={text}
      rows={compact ? 1 : 2}
      placeholder={placeholder}
      onChange={(event) => change(event.target.value)}
      onBlur={() => void save()}
      className={`block w-full resize-none rounded-xl border border-neutral-200 bg-white text-neutral-800 outline-none transition placeholder:text-neutral-300 focus:border-neutral-900 ${compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2.5 text-sm'}`}
    />
    {(statusText || error) && <p role={error ? 'alert' : 'status'} className={`mt-1 text-[11px] ${error ? 'text-red-600' : 'text-neutral-400'}`}>{error || statusText}</p>}
  </div>
}
