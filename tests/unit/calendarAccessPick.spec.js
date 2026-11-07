import { expect, test } from '@playwright/test'
import { pickPrimaryRow } from '../../api/_lib/googleCalendarApi.js'

test('uma linha só: devolve ela', () => {
  expect(pickPrimaryRow([{ id: 'A' }])).toEqual({ id: 'A' })
})

test('nenhuma linha: devolve null, não erro', () => {
  // Conta sem clínica é caso normal (contas anteriores à criação de `clinics`).
  expect(pickPrimaryRow([])).toBeNull()
  expect(pickPrimaryRow(null)).toBeNull()
})

test('várias linhas: escolhe a mais antiga, sem estourar', () => {
  // Era aqui que a integração inteira caía: `maybeSingle()` tolera zero linhas mas
  // ainda erra com duas (PGRST116), e o erro derrubava o status do Google Agenda.
  const linhas = [
    { id: 'B', created_at: '2026-05-10T00:00:00Z' },
    { id: 'A', created_at: '2026-01-02T00:00:00Z' },
    { id: 'C', created_at: '2026-09-01T00:00:00Z' },
  ]
  expect(pickPrimaryRow(linhas).id).toBe('A')
})

test('escolha é estável quando a data empata ou falta', () => {
  // Sem desempate, a clínica escolhida mudaria entre duas requisições iguais.
  const semData = [{ id: 'z' }, { id: 'a' }, { id: 'm' }]
  expect(pickPrimaryRow(semData).id).toBe('a')
  const empate = [{ id: 'z', created_at: '2026-01-01' }, { id: 'a', created_at: '2026-01-01' }]
  expect(pickPrimaryRow(empate).id).toBe('a')
})

test('linha com data sempre vence linha sem data', () => {
  const misto = [{ id: 'sem' }, { id: 'com', created_at: '2026-03-03' }]
  expect(pickPrimaryRow(misto).id).toBe('com')
})

test('não altera o array recebido', () => {
  const linhas = [{ id: 'B', created_at: '2026-05-10' }, { id: 'A', created_at: '2026-01-02' }]
  pickPrimaryRow(linhas)
  expect(linhas[0].id).toBe('B')
})
