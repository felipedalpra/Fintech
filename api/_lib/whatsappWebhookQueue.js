export const WEBHOOK_REPLAY_MAX_ATTEMPTS = 10
export const WEBHOOK_REPLAY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const PERMANENT_FAILURES = [
  /m[ií]dia recebida excede 16\s*MB/i,
]

// A auditoria dura 90 dias, mas "histórico" não é sinônimo de "pendência".
// A tela oferece reprocessamento apenas enquanto ainda existe uma chance real de
// recuperação. Falhas permanentes, esgotadas ou antigas continuam guardadas no
// banco para auditoria, sem alarmar a clínica indefinidamente.
export function isReplayableWebhookEvent(event, { now = Date.now() } = {}) {
  const status = String(event?.processing_status || '')
  if (!['failed', 'ignored', 'received'].includes(status)) return false
  if (status === 'ignored' && !String(event?.error_message || '').trim()) return false

  const attempts = Number(event?.attempts || 0)
  if (!Number.isFinite(attempts) || attempts < 1 || attempts >= WEBHOOK_REPLAY_MAX_ATTEMPTS) return false

  const receivedAt = Date.parse(event?.received_at)
  if (!Number.isFinite(receivedAt) || now - receivedAt > WEBHOOK_REPLAY_MAX_AGE_MS) return false

  const error = String(event?.error_message || '')
  if (PERMANENT_FAILURES.some(pattern => pattern.test(error))) return false
  return true
}
