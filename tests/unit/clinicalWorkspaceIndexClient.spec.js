import { expect, test } from '@playwright/test'
import { collectClinicalWorkspacePages } from '../../src/lib/clinicalWorkspacePagination.js'

test('pagina fontes clínicas acima do limite padrão sem perder linhas', async () => {
  const source = Array.from({ length:1005 }, (_, index) => ({ id:`row-${String(index).padStart(4, '0')}` }))
  const ranges = []
  const result = await collectClinicalWorkspacePages(async (from, to) => {
    ranges.push([from, to])
    return { data:source.slice(from, to + 1), error:null }
  })

  expect(result.error).toBeNull()
  expect(result.data).toHaveLength(1005)
  expect(ranges).toEqual([[0, 999], [1000, 1999]])
})

test('descarta resultado parcial quando uma página clínica falha', async () => {
  const result = await collectClinicalWorkspacePages(async from => from === 0
    ? { data:Array.from({ length:1000 }, (_, index) => ({ id:index })), error:null }
    : { data:null, error:new Error('falha simulada') })

  expect(result.data).toEqual([])
  expect(result.error?.message).toBe('falha simulada')
})
