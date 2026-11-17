import { test, expect } from '@playwright/test'
import { validationMessage } from '../../src/lib/formValidation.js'

test('não trata true como erro de validação', () => {
  expect(validationMessage(true)).toBe('')
  expect(validationMessage(false)).toBe('')
  expect(validationMessage('')).toBe('')
})

test('preserva a mensagem explicativa do campo inválido', () => {
  expect(validationMessage('Informe um e-mail válido.')).toBe('Informe um e-mail válido.')
})
