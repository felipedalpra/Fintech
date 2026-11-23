import { expect, test } from '@playwright/test'
import { handlePlatformAdminRequest } from '../../api/_lib/platformAdmin.js'

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

test('sem sessão, responde 401 em vez de deixar a rejeição escapar (mesma classe de bug corrigida em saasBilling)', async () => {
  const req = { method: 'GET', headers: {}, body: {} }
  const res = mockRes()

  await expect(handlePlatformAdminRequest(req, res, 'platform-admin-list-accounts')).resolves.toBeDefined()
  expect(res.statusCode).toBe(401)
  expect(res.body.error).toContain('Sessão ausente')
})

test('método não suportado responde 405 em vez de crashar', async () => {
  const req = { method: 'DELETE', headers: {}, body: {} }
  const res = mockRes()

  await handlePlatformAdminRequest(req, res, 'platform-admin-list-accounts')
  expect(res.statusCode).toBe(405)
})

test('checagem de status (usada pelo roteador do frontend) nunca lança erro, mesmo sem sessão', async () => {
  const req = { method: 'GET', headers: {}, body: {} }
  const res = mockRes()

  await handlePlatformAdminRequest(req, res, 'platform-admin-status')
  expect(res.statusCode).toBe(200)
  expect(res.body).toEqual({ isPlatformAdmin: false })
})
