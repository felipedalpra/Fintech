import { test, expect } from '@playwright/test'
import { buildClinicalPatientIdentity } from '../../src/lib/clinicalPatientIdentity.js'

test('identifica CPF e telefone com rótulos legíveis', () => {
  expect(buildClinicalPatientIdentity({ date_of_birth:'17/11/1990', cpf:'52998224725', phone:'51999998888' })).toEqual([
    'Nascimento: 17/11/1990',
    'CPF: 529.982.247-25',
    'Telefone: (51) 99999-8888',
  ])
})

test('não apresenta identificador inválido como telefone', () => {
  expect(buildClinicalPatientIdentity({ phone:'120363047314647570' })).toEqual([
    'Nascimento: não informado',
    'Telefone cadastrado: revisar',
  ])
})
