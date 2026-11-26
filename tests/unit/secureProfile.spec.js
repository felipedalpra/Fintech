import { expect, test } from '@playwright/test'
import { getAuthenticatedUser } from '../../api/_lib/secureProfile.js'

test('sessão ausente é classificada como 401 sem vazar detalhe de autenticação', async () => {
  const error = await getAuthenticatedUser({ headers:{} }).catch(nextError => nextError)

  expect(error.statusCode).toBe(401)
  expect(error.publicCode).toBe('SESSION_REQUIRED')
  expect(error.message).toBe('Sessao obrigatoria.')
})
