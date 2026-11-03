import { expect, test } from '@playwright/test'
import { createBankClaimReleaseCoordinator, isStaleBankClaimError } from '../../src/lib/bankClaimRelease.js'

test('uma liberação concorrente idêntica executa um único RPC', async () => {
  let calls = 0
  let finish
  const release = createBankClaimReleaseCoordinator(async ids => {
    calls += 1
    await new Promise(resolve => { finish = resolve })
    return ids.length
  })

  const first = release(['linha-2', 'linha-1', 'linha-1'], 'claim-1')
  const second = release(['linha-1', 'linha-2'], 'claim-1')
  await Promise.resolve()
  expect(calls).toBe(1)
  finish()
  await expect(first).resolves.toBe(2)
  await expect(second).resolves.toBe(2)
})

test('liberação concluída não volta a chamar o banco', async () => {
  let calls = 0
  const release = createBankClaimReleaseCoordinator(async ids => {
    calls += 1
    return ids.length
  })

  await expect(release(['linha-1'], 'claim-1')).resolves.toBe(1)
  await expect(release(['linha-1'], 'claim-1')).resolves.toBe(0)
  expect(calls).toBe(1)
})

test('reserva obsoleta é encerrada localmente e não entra em retry', async () => {
  let calls = 0
  const release = createBankClaimReleaseCoordinator(async () => {
    calls += 1
    throw { code:'40001', message:'A reserva mudou ou a linha já originou um lançamento.' }
  })

  await expect(release(['linha-1'], 'claim-1', { tolerateStale:true })).resolves.toBe(0)
  await expect(release(['linha-1'], 'claim-1', { tolerateStale:true })).resolves.toBe(0)
  expect(calls).toBe(1)
})

test('lote misto libera as linhas válidas e isola a obsoleta sem concorrência', async () => {
  const calls = []
  let active = 0
  let maxActive = 0
  const release = createBankClaimReleaseCoordinator(async ids => {
    calls.push(ids)
    active += 1
    maxActive = Math.max(maxActive, active)
    await Promise.resolve()
    active -= 1
    if (ids.includes('linha-obsoleta')) {
      throw { code:'40001', message:'A reserva mudou ou a linha já originou um lançamento.' }
    }
    return ids.length
  })

  await expect(release(
    ['linha-1', 'linha-obsoleta', 'linha-2'],
    'claim-1',
    { tolerateStale:true },
  )).resolves.toBe(2)
  expect(calls.some(ids => ids.length === 2 && ids.includes('linha-1') && ids.includes('linha-2'))).toBe(true)
  expect(calls.some(ids => ids.length === 1 && ids[0] === 'linha-obsoleta')).toBe(true)
  expect(maxActive).toBe(1)
})

test('tolerância é aplicada por caller, não herdada da promise compartilhada', async () => {
  let rejectRelease
  const release = createBankClaimReleaseCoordinator(() => new Promise((_, reject) => {
    rejectRelease = reject
  }))
  const stale = { code:'40001', message:'A reserva mudou ou a linha já originou um lançamento.' }

  const tolerant = release(['linha-1'], 'claim-1', { tolerateStale:true })
  const strict = release(['linha-1'], 'claim-1')
  await Promise.resolve()
  rejectRelease(stale)

  await expect(tolerant).resolves.toBe(0)
  await expect(strict).rejects.toMatchObject({ code:'40001' })
})

test('erro real continua visível e pode ser tentado novamente', async () => {
  let calls = 0
  const release = createBankClaimReleaseCoordinator(async () => {
    calls += 1
    throw new Error('rede indisponível')
  })

  await expect(release(['linha-1'], 'claim-1', { tolerateStale:true })).rejects.toThrow('rede indisponível')
  await expect(release(['linha-1'], 'claim-1', { tolerateStale:true })).rejects.toThrow('rede indisponível')
  expect(calls).toBe(2)
})

test('erro síncrono também limpa a coordenação para uma tentativa posterior', async () => {
  let calls = 0
  const release = createBankClaimReleaseCoordinator(() => {
    calls += 1
    throw new Error('falha antes da requisição')
  })

  await expect(release(['linha-1'], 'claim-1')).rejects.toThrow('falha antes da requisição')
  await expect(release(['linha-1'], 'claim-1')).rejects.toThrow('falha antes da requisição')
  expect(calls).toBe(2)
})

test('só o 40001 específico de reserva é tratado como limpeza concluída', () => {
  expect(isStaleBankClaimError({ code:'40001', message:'A reserva mudou ou a linha já originou um lançamento.' })).toBe(true)
  expect(isStaleBankClaimError({ code:'40001', message:'Falha de serialização desconhecida.' })).toBe(false)
  expect(isStaleBankClaimError({ code:'42501', message:'A reserva mudou.' })).toBe(false)
})
