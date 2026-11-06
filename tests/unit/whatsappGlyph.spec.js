import { expect, test } from '@playwright/test'
import { WHATSAPP_PATH } from '../../src/components/WhatsAppGlyph.jsx'

test('o glifo é o do WhatsApp, não um balão genérico', () => {
  // O ícone antigo era um caminho de 1 linha: círculo com rabicho, sem o telefone.
  // O oficial tem o balão E o handset, por isso é bem mais longo.
  expect(WHATSAPP_PATH.length).toBeGreaterThan(900)
  expect(WHATSAPP_PATH.startsWith('M17.472 14.382')).toBe(true)
  // Fechado para preenchimento: desenhado para `fill`, nunca para traço.
  expect(WHATSAPP_PATH.trim().endsWith('Z')).toBe(true)
})

test('o caminho não contém quebra de linha nem espaço duplicado que quebre o SVG', () => {
  expect(WHATSAPP_PATH).not.toMatch(/\n/)
  expect(WHATSAPP_PATH).not.toMatch(/ {2}/)
})
