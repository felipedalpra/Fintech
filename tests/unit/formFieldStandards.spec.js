import { expect, test } from '@playwright/test'
import {
  buildProfessionalRegistration, formatCep, formatCpf, formatCpfCnpj, formatEmail,
  formatPhone, formatUf, isValidCnpj, isValidCpf, isValidEmail, isValidPhone,
  parseProfessionalRegistration, validateContactIdentity,
} from '../../src/lib/formFieldStandards.js'

test('limita e formata documentos, telefone, CEP, UF e e-mail enquanto a pessoa digita', () => {
  expect(formatCpf('52998224725123')).toBe('529.982.247-25')
  expect(formatCpfCnpj('11222333000181')).toBe('11.222.333/0001-81')
  expect(formatPhone('51991897471')).toBe('(51) 99189-7471')
  expect(formatPhone('5551991897471')).toBe('+55 (51) 99189-7471')
  expect(formatCep('900001234')).toBe('90000-123')
  expect(formatUf('r1s')).toBe('RS')
  expect(formatEmail(' Medica @Clinica.COM ')).toBe('medica@clinica.com')
})

test('valida valores reais e recusa sequências ou formatos incompletos', () => {
  expect(isValidCpf('529.982.247-25')).toBe(true)
  expect(isValidCpf('111.111.111-11')).toBe(false)
  expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
  expect(isValidPhone('(51) 99189-7471')).toBe(true)
  expect(isValidPhone('99189-7471')).toBe(false)
  expect(isValidEmail('medica@clinica.com.br')).toBe(true)
  expect(isValidEmail('medica@clinica')).toBe(false)
  expect(validateContactIdentity({ cpf:'111.111.111-11' })).toContain('CPF válido')
})

test('monta e reabre o CRM canônico sem exigir que a pessoa conheça o formato', () => {
  expect(buildProfessionalRegistration('CRM', 'rs', '12.345')).toBe('CRM-RS 12345')
  expect(parseProfessionalRegistration('CRM-RS 12345')).toEqual({ state:'RS', number:'12345' })
})
