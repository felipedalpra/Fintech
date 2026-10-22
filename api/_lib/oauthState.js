// api/_lib/oauthState.js
// CSRF state genérica pra fluxos OAuth (Google Agenda, Meta Ads, etc.): HMAC assinado
// com TTL curto. Carrega só o id do usuário que iniciou o fluxo — nunca dado sensível.
import crypto from 'crypto'

const STATE_TTL_MS = 10 * 60 * 1000

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url')
}

export function signState(userId, secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ uid:userId, exp:now + STATE_TTL_MS })).toString('base64url')
  return `${body}.${sign(body, secret)}`
}

export function verifyState(state, secret, now = Date.now()) {
  const [body, signature] = String(state || '').split('.')
  if (!body || !signature) return null
  const expected = Buffer.from(sign(body, secret))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    return parsed.exp > now ? parsed.uid : null
  } catch {
    return null
  }
}
