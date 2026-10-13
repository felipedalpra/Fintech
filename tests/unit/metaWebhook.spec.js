import { expect, test } from '@playwright/test'
import crypto from 'crypto'
import { Readable } from 'stream'
import handler from '../../api/whatsapp.js'

function request(body, { action = 'meta-webhook', signature } = {}) {
  const req = Readable.from([Buffer.from(body)])
  req.method = 'POST'
  req.query = { action }
  req.headers = signature ? { 'x-hub-signature-256': signature } : {}
  return req
}

function response() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.payload = payload; return this },
    send(payload) { this.payload = payload; return this },
    end() { return this },
  }
}

test('webhook Meta preserva o corpo bruto e aceita assinatura válida', async () => {
  const previous = {
    appSecret: process.env.META_APP_SECRET,
    graphVersion: process.env.META_GRAPH_VERSION,
    supabaseUrl: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  const body = JSON.stringify({ object: 'page', entry: [] })
  process.env.META_APP_SECRET = 'app-secret'
  process.env.META_GRAPH_VERSION = 'v99.0'
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  const signature = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(body).digest('hex')

  try {
    const req = request(body, { signature })
    const res = response()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.payload).toEqual({ ok: true })
    expect(req.rawBody.toString('utf8')).toBe(body)
    expect(req.body).toEqual({ object: 'page', entry: [] })
  } finally {
    restoreEnv('META_APP_SECRET', previous.appSecret)
    restoreEnv('META_GRAPH_VERSION', previous.graphVersion)
    restoreEnv('SUPABASE_URL', previous.supabaseUrl)
    restoreEnv('SUPABASE_SERVICE_ROLE_KEY', previous.serviceKey)
  }
})

test('webhook Meta rejeita assinatura inválida', async () => {
  const previousSecret = process.env.META_APP_SECRET
  const previousVersion = process.env.META_GRAPH_VERSION
  process.env.META_APP_SECRET = 'app-secret'
  process.env.META_GRAPH_VERSION = 'v99.0'

  try {
    const res = response()
    await handler(request('{}', { signature: 'sha256=invalid' }), res)
    expect(res.statusCode).toBe(401)
    expect(res.payload).toEqual({ error: 'Invalid signature' })
  } finally {
    restoreEnv('META_APP_SECRET', previousSecret)
    restoreEnv('META_GRAPH_VERSION', previousVersion)
  }
})

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
