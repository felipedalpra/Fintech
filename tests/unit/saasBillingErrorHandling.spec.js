import { expect, test } from '@playwright/test'
import { handleSaasBillingRequest } from '../../api/_lib/saasBilling.js'

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(code) { res.statusCode = code; return res },
    json(payload) { res.body = payload; return res },
    setHeader(key, value) { res.headers[key] = value },
  }
  return res
}

test('erro assíncrono dentro do handler não escapa como rejeição não tratada (crash da função)', async () => {
  // Sem Authorization, requireAdminOwner rejeita de forma assíncrona (401) dentro de
  // handleSaveContact. Antes da correção, o dispatcher fazia `return handleX(req, res)`
  // sem `await`, então o try/catch nunca via essa rejeição: ela escapava como promessa
  // não tratada e a função inteira crashava (FUNCTION_INVOCATION_FAILED na Vercel) em
  // vez de responder com o JSON de erro esperado.
  const req = { method: 'POST', headers: {}, body: {} }
  const res = mockRes()

  await expect(handleSaasBillingRequest(req, res, 'saas-billing-save-contact')).resolves.toBeDefined()
  expect(res.statusCode).toBe(401)
  expect(res.body.error).toContain('Sessão ausente')
})
