import { describe, expect, it } from 'vitest'
import { numberInputError, numberToInputValue, parseNumberInput, sanitizeNumberInput } from './numbers'

describe('campos numéricos', () => {
  it('acepta coma o punto y limita los decimales al teclear', () => {
    expect(sanitizeNumberInput('2,505', 2)).toBe('2.50')
    expect(sanitizeNumberInput('1.2.3', 2)).toBe('1.23')
    expect(sanitizeNumberInput(' 12 g', 2)).toBe('12')
    expect(sanitizeNumberInput('3,', 2)).toBe('3.')
    expect(sanitizeNumberInput('-4', 2)).toBe('4')
    expect(sanitizeNumberInput('15,5', 0)).toBe('15')
    expect(sanitizeNumberInput('7,25', 1)).toBe('7.2')
  })

  it('interpreta el valor y trata lo vacío como null', () => {
    expect(parseNumberInput('2,5')).toBe(2.5)
    expect(parseNumberInput('3.')).toBe(3)
    expect(parseNumberInput('')).toBeNull()
    expect(parseNumberInput('.')).toBeNull()
  })

  it('valida el rango según el tipo de campo', () => {
    expect(numberInputError('0', 'quantity')).toBe('Debe ser mayor que 0.')
    expect(numberInputError('0', 'quantity', true)).toBeNull()
    expect(numberInputError('0', 'money')).toBeNull()
    expect(numberInputError('0.5', 'servings')).toBeNull()
    expect(numberInputError('', 'servings')).toBeNull()
  })

  it('redondea los valores iniciales a los decimales del campo', () => {
    expect(numberToInputValue(1 / 3, 'quantity')).toBe('0.33')
    expect(numberToInputValue(150, 'quantity')).toBe('150')
    expect(numberToInputValue(null, 'money')).toBe('')
    expect(numberToInputValue(12.36, 'nutrition')).toBe('12.4')
  })
})
