import { expect, test } from '@playwright/test'
import { maskEmail, maskMoney, maskName, maskPhone, maskText } from '../../src/lib/privacyMask.js'

test('nome vira pontinhos preservando a quantidade de palavras', () => {
  // Preservar a forma mantém o layout estável: a tela não "pula" ao ligar o modo.
  expect(maskName('Vitoria Ribeiro')).toBe('••••••• •••••••')
  expect(maskName('Ana')).toBe('•••')
})

test('nome muito longo não vira uma fileira infinita de pontos', () => {
  const longo = maskName('Maria Aparecida dos Santos Albuquerque Vasconcelos')
  for (const palavra of longo.split(' ')) expect(palavra.length).toBeLessThanOrEqual(10)
})

test('e-mail é mascarado por inteiro, inclusive o domínio', () => {
  // Só o domínio já identifica a clínica; metade escondida não serve para um vídeo público.
  const m = maskEmail('vitoria.ribeiroo.cardoso@gmail.com')
  expect(m).not.toContain('vitoria')
  expect(m).not.toContain('gmail')
  expect(m).toContain('@')
})

test('telefone mantém o formato, sem nenhum dígito real', () => {
  const m = maskPhone('(61) 99876-5432')
  expect(m).toMatch(/^\(••\) •••••-••••$/)
  expect(m).not.toMatch(/\d/)
})

test('dinheiro continua lendo como dinheiro', () => {
  expect(maskMoney()).toBe('R$ •••••')
})

test('texto livre é mascarado sem vazar nada do conteúdo', () => {
  // Corpo de mensagem do WhatsApp: pode conter qualquer coisa, inclusive dado de saúde.
  const m = maskText('Oi, aqui é a Ana, confirmo a cirurgia dia 12')
  expect(m).not.toMatch(/[A-Za-zÀ-ÿ0-9]/)
  expect(m.length).toBeGreaterThan(0)
})

test('valor vazio não vira pontinhos: ausente continua ausente', () => {
  // Mascarar o nada inventaria a existência de um dado que não existe.
  for (const vazio of [null, undefined, '']) {
    expect(maskName(vazio)).toBe('')
    expect(maskEmail(vazio)).toBe('')
    expect(maskPhone(vazio)).toBe('')
    expect(maskText(vazio)).toBe('')
  }
})

test('mascarar é idempotente: pontinhos já mascarados não crescem', () => {
  const uma = maskName('Vitoria Ribeiro')
  expect(maskName(uma)).toBe(uma)
})
