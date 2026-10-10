import { expect, test } from '@playwright/test'
import { normalizePhone, phoneCore, parseIncomingMessage, matchPatientId } from '../../api/_lib/whatsapp.js'

test('normalizePhone mantém só dígitos', () => {
  expect(normalizePhone('(11) 98888-7777')).toBe('11988887777')
  expect(normalizePhone('+55 11 98888 7777')).toBe('5511988887777')
  expect(normalizePhone(null)).toBe('')
  expect(normalizePhone(undefined)).toBe('')
})

test('phoneCore usa os últimos 8 dígitos (ignora DDI/DDD/9º dígito)', () => {
  expect(phoneCore('5511988887777')).toBe('88887777')
  expect(phoneCore('11988887777')).toBe('88887777')
  expect(phoneCore('(11) 98888-7777')).toBe('88887777')
})

test('parseIncomingMessage: mensagem recebida do Z-API', () => {
  const r = parseIncomingMessage({ phone: '5511988887777', text: { message: 'Olá, doutora' }, messageId: 'ABC123' })
  expect(r).toEqual({ phone: '5511988887777', text: 'Olá, doutora', providerMessageId: 'ABC123' })
})

test('parseIncomingMessage: ignora eco da própria mensagem (fromMe)', () => {
  expect(parseIncomingMessage({ phone: '5511988887777', text: { message: 'oi' }, fromMe: true })).toBeNull()
})

test('parseIncomingMessage: ignora payload sem texto ou sem telefone', () => {
  expect(parseIncomingMessage({ phone: '5511988887777' })).toBeNull()
  expect(parseIncomingMessage({ text: { message: 'oi' } })).toBeNull()
  expect(parseIncomingMessage(null)).toBeNull()
})

test('parseIncomingMessage: aceita formatos alternativos de campo', () => {
  expect(parseIncomingMessage({ from: '5511988887777', message: { conversation: 'oi' }, id: 'X1' }))
    .toEqual({ phone: '5511988887777', text: 'oi', providerMessageId: 'X1' })
  expect(parseIncomingMessage({ sender: { phone: '5511988887777' }, body: 'oi' }))
    .toEqual({ phone: '5511988887777', text: 'oi', providerMessageId: null })
})

const PATIENTS = [
  { id: 'p1', phone: '(11) 98888-7777' },
  { id: 'p2', phone: '11 97777-6666' },
]

test('matchPatientId: casa exatamente um paciente pelo núcleo do telefone', () => {
  expect(matchPatientId(PATIENTS, '5511988887777')).toBe('p1')
  expect(matchPatientId(PATIENTS, '+55 (11) 97777-6666')).toBe('p2')
})

test('matchPatientId: sem correspondência → null (não atribui)', () => {
  expect(matchPatientId(PATIENTS, '5511955554444')).toBeNull()
})

test('matchPatientId: ambíguo (dois pacientes, mesmo núcleo) → null (nunca chuta)', () => {
  const dup = [{ id: 'a', phone: '11988887777' }, { id: 'b', phone: '21988887777' }]
  expect(matchPatientId(dup, '5511988887777')).toBeNull()
})

test('matchPatientId: entrada inválida → null', () => {
  expect(matchPatientId(PATIENTS, '')).toBeNull()
  expect(matchPatientId(null, '5511988887777')).toBeNull()
})
