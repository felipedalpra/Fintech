import { expect, test } from '@playwright/test'
import { createSerializedTaskQueue } from '../../src/lib/serializedTaskQueue.js'

test('serializa gravacoes mesmo quando a primeira demora mais', async () => {
  const enqueue = createSerializedTaskQueue()
  const order = []
  let releaseFirst
  const firstGate = new Promise(resolve => { releaseFirst = resolve })

  const first = enqueue(async () => {
    order.push('first:start')
    await firstGate
    order.push('first:end')
    return 'first'
  })
  const second = enqueue(async () => {
    order.push('second:start')
    order.push('second:end')
    return 'second'
  })

  await expect.poll(() => order).toEqual(['first:start'])
  releaseFirst()

  await expect(first).resolves.toBe('first')
  await expect(second).resolves.toBe('second')
  expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
})

test('continua a fila depois de uma gravacao com erro', async () => {
  const enqueue = createSerializedTaskQueue()
  const order = []

  const failed = enqueue(async () => {
    order.push('failed')
    throw new Error('falha de rede')
  })
  const recovered = enqueue(async () => {
    order.push('recovered')
    return 'ok'
  })

  await expect(failed).rejects.toThrow('falha de rede')
  await expect(recovered).resolves.toBe('ok')
  expect(order).toEqual(['failed', 'recovered'])
})
