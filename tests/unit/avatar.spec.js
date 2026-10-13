import { expect, test } from '@playwright/test'
import { avatarColor, initials, AVATAR_COLORS } from '../../src/lib/avatar.js'

test('initials pega 2 letras de nome completo', () => {
  expect(initials('Mariana Costa')).toBe('MC')
  expect(initials('Juliana Alves Souza')).toBe('JA')
})

test('initials usa parte local do e-mail', () => {
  expect(initials('jonassg1996@gmail.com')).toBe('JO')
  expect(initials('sumary.oliveira@x.com')).toBe('SO')
})

test('initials lida com entrada vazia/única', () => {
  expect(initials('')).toBe('?')
  expect(initials('A')).toBe('A')
})

test('avatarColor é determinística e válida', () => {
  expect(avatarColor('abc')).toBe(avatarColor('abc'))
  expect(AVATAR_COLORS).toContain(avatarColor('qualquer-chave'))
})
