const MIXED_PREFIX = 'misto:'

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function round2(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100
}

export function encodePaymentMethod({
  paymentMode,
  paymentMethod,
  mixMethodA,
  mixMethodB,
  mixAmountA,
  mixAmountB,
}) {
  if (paymentMode !== 'misto') return paymentMethod || 'pix'
  const methodA = String(mixMethodA || 'pix').trim() || 'pix'
  const methodB = String(mixMethodB || 'cartao').trim() || 'cartao'
  const amountA = Math.max(0, round2(mixAmountA))
  const amountB = Math.max(0, round2(mixAmountB))
  return `${MIXED_PREFIX}${methodA}=${amountA.toFixed(2)};${methodB}=${amountB.toFixed(2)}`
}

export function decodePaymentMethod(rawMethod) {
  const raw = String(rawMethod || '').trim()
  if (!raw.startsWith(MIXED_PREFIX)) {
    return {
      paymentMode:'unico',
      paymentMethod:raw || 'pix',
      mixMethodA:'pix',
      mixMethodB:'cartao',
      mixAmountA:0,
      mixAmountB:0,
    }
  }

  const payload = raw.slice(MIXED_PREFIX.length)
  const parts = payload
    .split(';')
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => {
      const [methodRaw, amountRaw] = chunk.split('=')
      return {
        method:String(methodRaw || '').trim(),
        amount:Math.max(0, round2(amountRaw)),
      }
    })
    .filter(part => part.method)

  if (parts.length === 0) {
    return {
      paymentMode:'unico',
      paymentMethod:'pix',
      mixMethodA:'pix',
      mixMethodB:'cartao',
      mixAmountA:0,
      mixAmountB:0,
    }
  }

  const first = parts[0]
  const second = parts[1] || { method:'cartao', amount:0 }

  return {
    paymentMode:'misto',
    paymentMethod:'pix',
    mixMethodA:first.method,
    mixMethodB:second.method,
    mixAmountA:first.amount,
    mixAmountB:second.amount,
  }
}
