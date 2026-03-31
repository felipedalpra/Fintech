const MIXED_PREFIX = 'misto:'
const SCHEDULE_PREFIX = 'pagamentos:'

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
  payments,
}) {
  const normalizedPayments = Array.isArray(payments)
    ? payments
      .map(item => ({
        date:String(item?.date || '').trim(),
        amount:Math.max(0, round2(item?.amount)),
        method:String(item?.method || '').trim() || 'pix',
      }))
      .filter(item => item.date && item.amount > 0 && item.method)
    : []

  if (normalizedPayments.length > 0) {
    return `${SCHEDULE_PREFIX}${encodeURIComponent(JSON.stringify(normalizedPayments))}`
  }

  if (paymentMode !== 'misto') return paymentMethod || 'pix'
  const methodA = String(mixMethodA || 'pix').trim() || 'pix'
  const methodB = String(mixMethodB || 'cartao').trim() || 'cartao'
  const amountA = Math.max(0, round2(mixAmountA))
  const amountB = Math.max(0, round2(mixAmountB))
  return `${MIXED_PREFIX}${methodA}=${amountA.toFixed(2)};${methodB}=${amountB.toFixed(2)}`
}

export function decodePaymentMethod(rawMethod) {
  const raw = String(rawMethod || '').trim()
  if (raw.startsWith(SCHEDULE_PREFIX)) {
    const payload = raw.slice(SCHEDULE_PREFIX.length)
    try {
      const parsed = JSON.parse(decodeURIComponent(payload))
      const payments = Array.isArray(parsed) ? parsed.map(item => ({
        date:String(item?.date || '').trim(),
        amount:Math.max(0, round2(item?.amount)),
        method:String(item?.method || '').trim() || 'pix',
      })).filter(item => item.date && item.amount > 0 && item.method) : []
      if (payments.length > 0) {
        return {
          paymentMode:'unico',
          paymentMethod:payments[0].method,
          mixMethodA:'pix',
          mixMethodB:'cartao',
          mixAmountA:0,
          mixAmountB:0,
          paymentScheduleMode:'duas_datas',
          payments,
        }
      }
    } catch {
      // fallback to legacy parsing below
    }
  }

  if (!raw.startsWith(MIXED_PREFIX)) {
    return {
      paymentMode:'unico',
      paymentMethod:raw || 'pix',
      mixMethodA:'pix',
      mixMethodB:'cartao',
      mixAmountA:0,
      mixAmountB:0,
      paymentScheduleMode:'unica',
      payments:[],
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
      paymentScheduleMode:'unica',
      payments:[],
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
    paymentScheduleMode:'unica',
    payments:[],
  }
}
