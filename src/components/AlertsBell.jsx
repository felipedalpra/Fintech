import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../theme.js'
import { buildMetrics } from '../useMetrics.js'
import { fmt, getPeriodRange, today } from '../utils.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { loadWorkspacePreferences, saveWorkspacePreferences } from '../lib/operationalWorkspace.js'

function computeAlerts(data, summary) {
  const safeData = data || {}
  const safeSummary = summary || {}
  const alerts = []
  const now = new Date()
  const todayStr = today()
  const in7 = new Date(now)
  in7.setDate(in7.getDate() + 7)
  const in7Str = in7.toISOString().split('T')[0]

  if (Number(safeSummary.cashBalance || 0) < 0) {
    alerts.push({ level: 'danger', title: 'Caixa negativo', body: `Saldo atual: ${fmt(safeSummary.cashBalance || 0)}`, link: 'finance' })
  }

  const payables = safeSummary.accountsPayable || []
  const overdue = payables.filter(i => i.dueDate && i.dueDate < todayStr)
  if (overdue.length > 0) {
    const total = overdue.reduce((s, i) => s + (i.value || 0), 0)
    alerts.push({ level: 'danger', title: `${overdue.length} conta(s) vencida(s)`, body: `Total em aberto: ${fmt(total)}`, link: 'finance' })
  }

  const dueSoon = payables.filter(i => i.dueDate && i.dueDate >= todayStr && i.dueDate <= in7Str)
  if (dueSoon.length > 0) {
    const total = dueSoon.reduce((s, i) => s + (i.value || 0), 0)
    alerts.push({ level: 'warning', title: `${dueSoon.length} conta(s) vencem em 7 dias`, body: `Total: ${fmt(total)}`, link: 'finance' })
  }

  const goals = safeData.goals || []
  if (goals.length > 0) {
    const range = getPeriodRange('month')
    const m = buildMetrics(data, { startDate: range.start, endDate: range.end, balanceDate: range.end })
    const metricMap = {
      faturamento: m.grossRevenue,
      cirurgias: m.surgeriesCompleted,
      consultas: m.consultationsCompleted,
      lucro: m.netProfit,
      ticket_medio: m.averageTicket,
      fluxo_caixa: m.cashBalance,
    }
    goals.forEach(goal => {
      if (!goal.dueDate || !goal.target) return
      const daysLeft = Math.floor((new Date(goal.dueDate + 'T00:00:00') - now) / (1000 * 60 * 60 * 24))
      if (daysLeft < 0 || daysLeft > 14) return
      const current = metricMap[goal.metric] || 0
      const pct = (current / goal.target) * 100
      if (pct < 70) {
        alerts.push({ level: 'warning', title: `Meta "${goal.name}" em risco`, body: `${pct.toFixed(0)}% atingido · ${daysLeft}d restantes`, link: 'goals' })
      }
    })
  }

  return alerts
}

export function AlertsBell({ data, summary, onNavigate }) {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id
  const [open, setOpen] = useState(false)
  const [readKeys, setReadKeys] = useState([])
  const [notificationState, setNotificationState] = useState({})
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  const alerts = useMemo(() => computeAlerts(data, summary).map(alert => ({ ...alert, key:`${alert.title}|${alert.body}` })), [data, summary])
  useEffect(() => {
    if (!effectiveUserId || !user?.id) return
    loadWorkspacePreferences(effectiveUserId, user.id).then(result => {
      const state = result.data?.notification_state || {}
      setNotificationState(state)
      setReadKeys(state.finance || [])
    })
  }, [effectiveUserId, user?.id])
  const visibleAlerts = useMemo(() => alerts.filter(alert => !readKeys.includes(alert.key)), [alerts, readKeys])
  const total = visibleAlerts.length
  const dangerCount = visibleAlerts.filter(a => a.level === 'danger').length
  const badgeColor = dangerCount > 0 ? C.red : total > 0 ? C.yellow : null

  useEffect(() => {
    if (!open) return
    function handle(e) {
      const clickedTrigger = triggerRef.current?.contains(e.target)
      const clickedPanel = panelRef.current?.contains(e.target)
      if (!clickedTrigger && !clickedPanel) setOpen(false)
    }
    function handleKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const panelStyle = {
    position: 'fixed',
    top: 'max(64px, calc(env(safe-area-inset-top) + 12px))',
    right: 'max(12px, env(safe-area-inset-right))',
    zIndex: 5000,
    width: 'min(340px, calc(100vw - 24px))',
    maxHeight: 'calc(100dvh - 80px)',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    boxSizing: 'border-box',
    background: C.card,
    border: `1px solid ${C.borderBright}`,
    borderRadius: 14,
    boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
  }
  async function markAllRead() {
    const keys = alerts.map(alert => alert.key)
    setReadKeys(keys)
    const next = { ...notificationState, finance:keys }
    setNotificationState(next)
    await saveWorkspacePreferences(effectiveUserId, user.id, { notification_state:{ finance:keys } })
  }

  return (
    <div ref={triggerRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(v => !v)}
        title={total === 0 ? 'Sem alertas' : `${total} alerta(s)`}
        aria-label="Alertas"
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{
          position: 'relative',
          width: 34, height: 34, borderRadius: 999,
          border: `1px solid ${open ? C.accent + '55' : C.border}`,
          background: open ? C.accent + '14' : 'transparent',
          color: badgeColor ?? (open ? C.accent : C.textSub),
          cursor: 'pointer', fontFamily: 'inherit',
          display: 'grid', placeItems: 'center',
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
        </svg>
        {badgeColor && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            minWidth: 16, height: 16, borderRadius: 999,
            background: badgeColor, color: '#fff',
            fontSize: 9, fontWeight: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 3px', border: `2px solid ${C.bg}`, lineHeight: 1,
          }}>
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div ref={panelRef} role="dialog" aria-label="Alertas financeiros" data-testid="financial-alerts-popover" style={panelStyle}>
          <div style={{ padding: '12px 16px 10px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Alertas</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: total === 0 ? C.green : dangerCount > 0 ? C.red : C.yellow }}>
              {total === 0 ? '● Tudo em ordem' : `${total} alerta(s)`}
            </div>
            {total > 0 && <button type="button" onClick={markAllRead} style={{ border:0, background:'transparent', color:C.accent, cursor:'pointer', fontSize:10, fontWeight:700 }}>Marcar lidos</button>}
          </div>

          {total === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: C.textDim, fontSize: 13 }}>
              Nenhum alerta no momento.
            </div>
          ) : (
            <div>
              {visibleAlerts.map((alert, i) => (
                <div
                  key={alert.key}
                  onClick={() => { if (alert.link && typeof onNavigate === 'function') { onNavigate(alert.link); setOpen(false) } }}
                  style={{
                    padding: '12px 16px',
                    borderBottom: i < visibleAlerts.length - 1 ? `1px solid ${C.border}22` : 'none',
                    borderLeft: `3px solid ${alert.level === 'danger' ? C.red : C.yellow}`,
                    cursor: alert.link ? 'pointer' : 'default',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (alert.link) e.currentTarget.style.background = C.accent + '0A' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: alert.level === 'danger' ? C.red : C.yellow, marginBottom: 2 }}>
                    {alert.title}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim }}>{alert.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
