// src/lib/slaBusinessTime.js
// SLA de 1ª resposta — cálculo PURO de tempo em horário comercial (testável, sem I/O).
// Padrão: Seg–Sáb, 08h–19h, alvo de 15 min. Ajustável passando outra config.

export const SLA_CONFIG = {
  days: [1, 2, 3, 4, 5, 6], // 0=domingo … 6=sábado → seg a sáb
  openMin: 8 * 60,          // 08:00
  closeMin: 19 * 60,        // 19:00
  targetMin: 15,            // alvo de 1ª resposta
  maxTrackHours: 48,        // lead mais antigo que isto deixa de ser alerta de "responder já" (evita ruído)
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}
function minsOfDay(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
}

// Minutos de HORÁRIO COMERCIAL entre start e end (ignora noite, fins de semana fora dos dias úteis).
export function businessMinutesBetween(start, end, cfg = SLA_CONFIG) {
  const s = new Date(start)
  const e = new Date(end)
  if (!(e > s)) return 0
  const open = cfg.openMin
  const close = cfg.closeMin
  const days = new Set(cfg.days)
  let total = 0
  // Varre dia a dia (da data de start até a de end).
  const firstDayTime = startOfDay(s).getTime()
  const lastDay = startOfDay(e)
  const cursor = new Date(firstDayTime)
  while (cursor <= lastDay) {
    if (days.has(cursor.getDay())) {
      const isFirst = cursor.getTime() === firstDayTime
      const isLast = cursor.getTime() === lastDay.getTime()
      // janela comercial do dia, em minutos desde a meia-noite, cruzada com [s, e]
      const segStart = Math.max(open, isFirst ? minsOfDay(s) : 0)
      const segEnd = Math.min(close, isLast ? minsOfDay(e) : 24 * 60)
      if (segEnd > segStart) total += segEnd - segStart
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return Math.round(total)
}

// Estado do SLA de um lead. SLA só se aplica a leads em 'primeiro_contato'.
// respondido → first_response_at setado; ok → aberto, dentro do alvo; late → passou do alvo; na → sem SLA.
export function slaForLead(opp, now = new Date(), cfg = SLA_CONFIG) {
  if (!opp || !opp.created_at) return { state: 'na', minutes: 0 }
  if (opp.first_response_at) {
    return { state: 'respondido', minutes: businessMinutesBetween(opp.created_at, opp.first_response_at, cfg) }
  }
  if (opp.status !== 'aberto' || opp.stage !== 'primeiro_contato') return { state: 'na', minutes: 0 }
  // Lead muito antigo não é mais alerta de "responder já" — evita ruído de histórico abandonado.
  const wallHours = (now - new Date(opp.created_at)) / 3600000
  if (!Number.isFinite(wallHours) || (cfg.maxTrackHours != null && wallHours > cfg.maxTrackHours)) return { state: 'na', minutes: 0 }
  const elapsed = businessMinutesBetween(opp.created_at, now, cfg)
  if (elapsed >= cfg.targetMin) return { state: 'late', minutes: elapsed }
  return { state: 'ok', minutes: cfg.targetMin - elapsed }
}
