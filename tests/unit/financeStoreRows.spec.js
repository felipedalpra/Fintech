import { expect, test } from '@playwright/test'
import { mapExtraRevenuesRows } from '../../src/lib/financeStoreRows.js'

test('receita pendente não envia string vazia para coluna date do Supabase', () => {
  const [row] = mapExtraRevenuesRows('user-1', {
    extraRevenues:[{
      id:'revenue-1',
      description:'Mentoria',
      category:'outras_receitas',
      value:100,
      date:'',
      competenceDate:'2026-10-12',
      dueDate:'2026-11-12',
      receivedDate:null,
      originLabel:'Instagram',
      status:'pendente',
    }],
  })

  expect(row.date).toBe('2026-10-12')
  expect(row.received_date).toBeNull()
  expect(row.competence_date).toBe('2026-10-12')
  expect(row.due_date).toBe('2026-11-12')
  expect(row.origin_label).toBe('Instagram')
})
