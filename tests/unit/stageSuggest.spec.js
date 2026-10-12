import { expect, test } from '@playwright/test'
import {
  preFilterStages, shouldRunAI, isForward, stageRank,
  buildSuggestionInput, parseSuggestionResult,
} from '../../api/_lib/stageSuggest.js'

test('stageRank/isForward: ordem do funil', () => {
  expect(stageRank('primeiro_contato')).toBe(0)
  expect(stageRank('reserva_paga')).toBe(4)
  expect(stageRank('cirurgia_marcada')).toBe(5)
  expect(stageRank('cirurgia_feita')).toBe(6)
  expect(stageRank('follow_up')).toBe(7)
  expect(stageRank('inexistente')).toBe(-1)
  expect(isForward('primeiro_contato', 'consulta_agendada')).toBe(true)
  expect(isForward('consultado', 'primeiro_contato')).toBe(false) // não retrocede
  expect(isForward('consultado', 'consultado')).toBe(false)       // mesmo estágio
})

test('preFilterStages: detecta sinais por palavra-chave (ignora acentos)', () => {
  expect(preFilterStages('Posso marcar a consulta?')).toContain('consulta_agendada')
  expect(preFilterStages('quanto custa a lipo?')).toContain('orcamento_enviado')
  expect(preFilterStages('ja fiz o pix, pode reservar')).toContain('reserva_paga')
  expect(preFilterStages('vou pensar, te aviso')).toContain('follow_up')
  expect(preFilterStages('oi, bom dia')).toEqual([])
})

test('shouldRunAI: só roda se há sinal À FRENTE do estágio atual', () => {
  expect(shouldRunAI('quero marcar consulta', 'primeiro_contato')).toBe(true)
  expect(shouldRunAI('oi tudo bem?', 'primeiro_contato')).toBe(false)
  // sinal de agendar, mas já está mais à frente → não gasta IA
  expect(shouldRunAI('quero marcar consulta', 'reserva_paga')).toBe(false)
})

test('buildSuggestionInput: monta system+user com transcrição e estágio atual', () => {
  const input = buildSuggestionInput(
    [{ direction: 'inbound', body: 'quanto custa?' }, { direction: 'outbound', body: 'R$ 10 mil' }],
    'consulta_agendada',
  )
  expect(input).toHaveLength(2)
  expect(input[0].role).toBe('system')
  expect(input[0].content).toContain('consulta_agendada')
  expect(input[1].content).toContain('Paciente: quanto custa?')
  expect(input[1].content).toContain('Clínica: R$ 10 mil')
})

test('parseSuggestionResult: aceita avanço válido acima do limiar', () => {
  const raw = '{"stage":"orcamento_enviado","confidence":0.88,"reason":"pediu valores"}'
  expect(parseSuggestionResult(raw, { currentStage: 'consulta_agendada', minConfidence: 0.7 }))
    .toEqual({ stage: 'orcamento_enviado', confidence: 0.88, reason: 'pediu valores' })
})

test('parseSuggestionResult: extrai JSON mesmo com texto em volta', () => {
  const raw = 'Claro! {"stage":"reserva_paga","confidence":0.9,"reason":"pagou"} pronto'
  expect(parseSuggestionResult(raw, { currentStage: 'orcamento_enviado' }).stage).toBe('reserva_paga')
})

test('parseSuggestionResult: rejeita abaixo do limiar', () => {
  const raw = '{"stage":"orcamento_enviado","confidence":0.5,"reason":"talvez"}'
  expect(parseSuggestionResult(raw, { currentStage: 'consulta_agendada', minConfidence: 0.7 })).toBeNull()
})

test('parseSuggestionResult: rejeita retrocesso (forward-only)', () => {
  const raw = '{"stage":"primeiro_contato","confidence":0.99,"reason":"x"}'
  expect(parseSuggestionResult(raw, { currentStage: 'consultado' })).toBeNull()
})

test('parseSuggestionResult: rejeita estágio desconhecido e JSON inválido', () => {
  expect(parseSuggestionResult('{"stage":"ganho","confidence":0.9}', { currentStage: 'consulta_agendada' })).toBeNull()
  expect(parseSuggestionResult('não é json', { currentStage: 'consulta_agendada' })).toBeNull()
  expect(parseSuggestionResult('', { currentStage: 'consulta_agendada' })).toBeNull()
})

test('parseSuggestionResult: clampa confiança > 1 e exige avanço', () => {
  const raw = '{"stage":"consultado","confidence":1.4,"reason":"ok"}'
  expect(parseSuggestionResult(raw, { currentStage: 'consulta_agendada', minConfidence: 0.7 }))
    .toEqual({ stage: 'consultado', confidence: 1, reason: 'ok' })
})
