const MAX_SETTLED_RELEASES = 200

export function isStaleBankClaimError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || error?.details || '').toLowerCase()
  return code === '40001' && (
    message.includes('reserva mudou') ||
    message.includes('linha já originou') ||
    message.includes('linha ja originou') ||
    message.includes('já foram reservadas') ||
    message.includes('ja foram reservadas')
  )
}

function normalizeLineIds(lineIds) {
  return [...new Set((lineIds || []).filter(Boolean))].sort()
}

function releaseKey(lineIds, claimToken) {
  return `${claimToken}:${lineIds.join(',')}`
}

// Uma aprovação em lote pode falhar depois de reservar muitas linhas. Todas
// pertencem à mesma importação, então disparar um RPC por linha cria contenção
// no lock da importação e uma fila de erros 40001. Este coordenador garante um
// único RPC por conjunto e não repete uma limpeza que já terminou ou ficou
// obsoleta porque a linha já originou um lançamento.
export function createBankClaimReleaseCoordinator(release) {
  const inFlight = new Map()
  const releasedKeys = new Set()
  const staleResolved = new Set()

  function remember(cache, key) {
    cache.add(key)
    if (cache.size <= MAX_SETTLED_RELEASES) return
    cache.delete(cache.values().next().value)
  }

  function releaseOnce(ids, claimToken) {
    const key = releaseKey(ids, claimToken)
    if (releasedKeys.has(key)) return Promise.resolve(0)
    if (inFlight.has(key)) return inFlight.get(key)

    const request = Promise.resolve()
      .then(() => release(ids, claimToken))
      .then(releasedCount => {
        remember(releasedKeys, key)
        return releasedCount
      })
      .finally(() => {
        inFlight.delete(key)
      })

    inFlight.set(key, request)
    return request
  }

  return async function coordinateRelease(lineIds, claimToken, { tolerateStale = false } = {}) {
    const ids = normalizeLineIds(lineIds)
    if (!ids.length || !claimToken) throw new Error('Reserva de criação inválida.')
    const key = releaseKey(ids, claimToken)
    if (tolerateStale && staleResolved.has(key)) return 0

    try {
      return await releaseOnce(ids, claimToken)
    } catch (error) {
      if (!tolerateStale || !isStaleBankClaimError(error)) throw error
      if (ids.length === 1) {
        remember(staleResolved, key)
        return 0
      }

      // O RPC é transacional: uma linha obsoleta reverte a liberação das demais.
      // Divide em sequência até isolar a obsoleta, sem voltar ao fan-out paralelo
      // que saturou o banco. Subconjuntos válidos continuam sendo liberados.
      const middle = Math.ceil(ids.length / 2)
      const leftReleased = await coordinateRelease(ids.slice(0, middle), claimToken, { tolerateStale:true })
      const rightReleased = await coordinateRelease(ids.slice(middle), claimToken, { tolerateStale:true })
      remember(staleResolved, key)
      return leftReleased + rightReleased
    }
  }
}
