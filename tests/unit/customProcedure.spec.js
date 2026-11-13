import { expect, test } from '@playwright/test'
import { CUSTOM_PROCEDURE_VALUE, procedureDisplayName, resolveCustomProcedureFields } from '../../src/lib/customProcedure.js'

const procedures = [{ id: 'p1', name: 'Mamoplastia', color: '#f59e0b' }]

test('procedureDisplayName prioriza catálogo, depois texto livre, depois fallback', () => {
  expect(procedureDisplayName({ procedureId: 'p1' }, procedures, 'Sem procedimento')).toBe('Mamoplastia')
  expect(procedureDisplayName({ procedureId: null, customProcedureName: 'Mamoplastia + Braquioplastia' }, procedures, 'Sem procedimento')).toBe('Mamoplastia + Braquioplastia')
  expect(procedureDisplayName({ procedureId: null, customProcedureName: '' }, procedures, 'Sem procedimento')).toBe('Sem procedimento')
})

test('resolveCustomProcedureFields nunca salva os dois ao mesmo tempo', () => {
  expect(resolveCustomProcedureFields('p1', '')).toEqual({ procedureId: 'p1', customProcedureName: null })
  expect(resolveCustomProcedureFields(CUSTOM_PROCEDURE_VALUE, '  Mamoplastia + Braquioplastia  ')).toEqual({
    procedureId: null,
    customProcedureName: 'Mamoplastia + Braquioplastia',
  })
  expect(resolveCustomProcedureFields('', '')).toEqual({ procedureId: null, customProcedureName: null })
})
