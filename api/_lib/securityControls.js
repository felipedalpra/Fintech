import { createHash } from 'node:crypto'

function clientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'] || req?.headers?.['x-real-ip'] || ''
  return String(forwarded).split(',')[0].trim().slice(0, 80) || 'unknown'
}

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex')
}

export async function enforceRateLimit({ admin, req, scope, identity = '' , limit, windowSeconds }) {
  if (!admin) return { allowed:true, configured:false }
  const key = `${scope}:${identity || clientIp(req)}`
  const { data, error } = await admin.rpc('consume_api_rate_limit', {
    p_key_hash: digest(key),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) {
    const schemaUnavailable = ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(error.code)
    // A migration ausente deve ser observável e não pode quebrar um deploy em duas fases.
    console.error('[security] rate limiter indisponível:', error.code || error.message)
    if (schemaUnavailable || process.env.NODE_ENV === 'test' || process.env.VERCEL !== '1') return { allowed:true, configured:false }
    return { allowed:false, configured:true, retryAfter:30 }
  }
  const result = Array.isArray(data) ? data[0] : data
  return {
    allowed: result?.allowed !== false,
    configured:true,
    remaining:Number(result?.remaining ?? 0),
    retryAfter:Number(result?.retry_after_seconds ?? windowSeconds),
  }
}

export function rateLimitResponse(res, result) {
  if (result.allowed) return false
  res.setHeader?.('Retry-After', String(Math.max(1, result.retryAfter || 1)))
  res.setHeader?.('X-RateLimit-Remaining', '0')
  res.status(429).json({ error:'Muitas tentativas. Aguarde antes de tentar novamente.' })
  return true
}

export async function recordSecurityEvent(admin, event) {
  if (!admin) return
  const { error } = await admin.from('security_events').insert({
    event_type:String(event.eventType || 'unknown').slice(0, 80),
    severity:event.severity || 'warning',
    actor_id:event.actorId || null,
    owner_id:event.ownerId || null,
    request_ip:String(event.requestIp || '').slice(0, 80) || null,
    route:String(event.route || '').slice(0, 160) || null,
    metadata:event.metadata && typeof event.metadata === 'object' ? event.metadata : {},
  })
  if (error) console.error('[security] evento não registrado:', error.code || error.message)
}

