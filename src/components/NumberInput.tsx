import { useEffect, useRef, type InputHTMLAttributes } from 'react'
import { numberInputError, numberRules, sanitizeNumberInput, type NumberKind } from '../lib/numbers'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'inputMode' | 'min' | 'step'> & {
  kind: NumberKind
  value: string
  onValueChange: (value: string) => void
  allowZero?: boolean
}

// Campo numérico común: teclado numérico en el móvil, acepta coma o punto y
// limita los decimales según el tipo. Si el valor está fuera de rango, el
// navegador impide enviar el formulario y muestra el motivo.
export function NumberInput({ kind, value, onValueChange, allowZero = false, ...rest }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const rule = numberRules[kind]

  useEffect(() => {
    ref.current?.setCustomValidity(numberInputError(value, kind, allowZero) ?? '')
  }, [value, kind, allowZero])

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode={rule.decimals === 0 ? 'numeric' : 'decimal'}
      autoComplete="off"
      value={value}
      onChange={(event) => onValueChange(sanitizeNumberInput(event.target.value, rule.decimals))}
    />
  )
}
