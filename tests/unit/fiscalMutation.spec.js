import { expect, test } from '@playwright/test'
import { persistFiscalMutation } from '../../src/lib/fiscalMutation.js'

test('falha de refresh não transforma persistência fiscal confirmada em falha', async () => {
  let mutations = 0
  const result = await persistFiscalMutation(
    async () => { mutations += 1; return { id:'doc-1' } },
    async () => { throw new Error('offline') },
  )
  expect(mutations).toBe(1)
  expect(result.persisted).toEqual({ id:'doc-1' })
  expect(result.refreshError?.message).toBe('offline')
})

test('falha da mutação continua rejeitando sem executar refresh', async () => {
  let refreshed = false
  await expect(persistFiscalMutation(
    async () => { throw new Error('negado') },
    async () => { refreshed = true },
  )).rejects.toThrow('negado')
  expect(refreshed).toBe(false)
})
