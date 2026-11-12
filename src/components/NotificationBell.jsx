import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { buildMetrics } from '../useMetrics.js'
import { fmt, getPeriodRange, today } from '../utils.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { loadWorkspacePreferences, saveWorkspacePreferences } from '../lib/operationalWorkspace.js'
import { groupTasksByDue } from '../lib/taskGroups.js'
// Tarefa aberta = pendente OU aguardando (crm_workspace_phase2.sql).
import { OPEN_TASK_STATUSES } from '../lib/taskQueue.js'
import { slaForLead, SLA_CONFIG } from '../lib/slaBusinessTime.js'
import { stageLabel } from '../lib/timeline.js'
import { isCrmContactSchemaMissing, opportunityPerson } from '../lib/crmContact.js'
import { loadMentions } from '../lib/crmWorkspaceStore.js'
import { loadTaskMentions } from '../lib/taskWorkspaceStore.js'
import { mentionAlerts, memberName } from '../lib/crmUpdates.js'

// Sino único de notificações: antes eram dois botões/painéis lado a lado (financeiro e CRM),
// uma duplicação sem necessidade — agora é um botão com a contagem combinada e um painel só,
// com as duas seções dentro. Cada seção mantém sua própria lógica de "marcar lidos" (gravam em
// chaves diferentes de notification_state: finance/crm), só a apresentação foi unificada.

const MENTION_DAYS = 30
const STALE_DAYS = 10

function computeFinancialAlerts(data, summary) {
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

function useFinancialAlerts(data, summary) {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id
  const [readKeys, setReadKeys] = useState([])
  const [notificationState, setNotificationState] = useState({})
  const [saveError, setSaveError] = useState('')

  const alerts = useMemo(() => computeFinancialAlerts(data, summary).map(alert => ({ ...alert, key: `${alert.title}|${alert.body}` })), [data, summary])
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

  async function markAllRead() {
    const keys = alerts.map(alert => alert.key)
    const result = await saveWorkspacePreferences(effectiveUserId, user.id, { notification_state: { finance: keys } })
    if (result.error || !result.persisted) { setSaveError('Os alertas NÃO foram marcados como lidos. Tente novamente.'); return }
    setSaveError('')
    setReadKeys(keys)
    setNotificationState({ ...notificationState, finance: keys })
  }

  return { visibleAlerts, total, dangerCount, saveError, markAllRead }
}

function daysSince(ts) {
  if (!ts) return null
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  return d >= 0 ? d : null
}
function itemLabel(item) {
  return opportunityPerson(item).name || item?.title || 'Oportunidade'
}
function shortDate(value) {
  if (!value) return 'sem data'
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
function Ico({ d, size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
}
const I = {
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  warn: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  user: <><circle cx="9" cy="8" r="4" /><path d="M3 20a6 6 0 0 1 12 0M17 11h5M19.5 8.5v5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  at: <><circle cx="12" cy="12" r="4" /><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9" /></>,
}

function useCrmAlerts() {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id
  const [tasks, setTasks] = useState([])
  const [opps, setOpps] = useState([])
  const [readKeys, setReadKeys] = useState([])
  const [notificationState, setNotificationState] = useState({})
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!effectiveUserId) return
    let mounted = true
    async function load() {
      try {
        const fetchOpportunities = async () => {
          let result = await supabase.from('opportunities').select('id, title, responsible_user_id, stage_entered_at, status, stage, created_at, first_response_at, patient_id, contact_id, patients(full_name, phone), crm_contacts(full_name, phone, status)').eq('user_id', effectiveUserId).eq('status', 'aberto')
          if (isCrmContactSchemaMissing(result.error)) {
            result = await supabase.from('opportunities').select('id, title, responsible_user_id, stage_entered_at, status, stage, created_at, first_response_at, patient_id, patients(full_name, phone)').eq('user_id', effectiveUserId).eq('status', 'aberto')
          }
          return result
        }
        const [taskRes, oppRes] = await Promise.all([
          supabase.from('tasks').select('id, title, due_date, status, patients(full_name), opportunities(title)').eq('user_id', effectiveUserId).in('status', OPEN_TASK_STATUSES),
          fetchOpportunities(),
        ])
        if (!mounted) return
        setTasks(taskRes.data ?? [])
        setOpps(oppRes.data ?? [])
      } catch { /* o sino é não-crítico: se falhar, não mostra alerta e não quebra o topo */ }
    }
    load()
    return () => { mounted = false }
  }, [effectiveUserId])

  // Menções em Atualizações de oportunidade (crm_workspace_phase3.sql). Chegam pelo Realtime:
  // o sino acende sem recarregar a página.
  const [mentions, setMentions] = useState([])
  const [teamLabel, setTeamLabel] = useState({})
  useEffect(() => {
    if (!effectiveUserId || !user?.id) return undefined
    let mounted = true
    const refresh = async () => {
      const since = new Date(Date.now() - MENTION_DAYS * 86400000).toISOString()
      // Oportunidade (opportunity_notes) + tarefa (task_comments, tasks_workspace_phase4.sql).
      const [oppList, taskList] = await Promise.all([
        loadMentions(effectiveUserId, user.id, since),
        loadTaskMentions(effectiveUserId, user.id, since),
      ])
      if (mounted) setMentions([...oppList, ...taskList.map(n => ({ ...n, kind: 'task' }))])
    }
    const onInsert = payload => {
      const note = payload?.new
      if (note && Array.isArray(note.mentions) && note.mentions.includes(user.id) && note.author_id !== user.id) refresh()
    }
    refresh()
    supabase.rpc('clinic_team').then(res => {
      if (mounted && !res.error) setTeamLabel(Object.fromEntries((res.data || []).map(m => [m.user_id, m.member_email])))
    }, () => {})
    let channel = null
    try {
      channel = supabase.channel(`notification-bell-mentions-${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'opportunity_notes', filter: `user_id=eq.${effectiveUserId}` }, onInsert)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_comments', filter: `user_id=eq.${effectiveUserId}` }, onInsert)
        .subscribe()
    } catch { /* sem Realtime, as menções aparecem na próxima carga */ }
    return () => { mounted = false; if (channel) supabase.removeChannel(channel) }
  }, [effectiveUserId, user?.id])

  useEffect(() => {
    if (!effectiveUserId || !user?.id) return
    loadWorkspacePreferences(effectiveUserId, user.id).then(result => {
      const state = result.data?.notification_state || {}
      setNotificationState(state)
      setReadKeys(state.crm || [])
    })
  }, [effectiveUserId, user?.id])

  const alerts = useMemo(() => {
    const g = groupTasksByDue(tasks)
    const list = []
    mentionAlerts(mentions, user?.id, { days: MENTION_DAYS }).forEach(note => {
      const isTask = note.kind === 'task'
      const opp = note.opportunities
      const where = isTask
        ? `tarefa “${note.tasks?.title || 'Tarefa'}”`
        : (opp?.patients?.full_name || (opp?.title && opp.title !== 'Oportunidade' ? opp.title : 'Oportunidade'))
      const text = String(note.body || '').replace(/\s+/g, ' ').trim()
      list.push({
        k: `mention-${isTask ? 'task-' : ''}${note.id}`, type: 'Menções', color: C.accent || '#3b82f6', icon: I.at,
        title: `${memberName(teamLabel, note.author_id)} mencionou você · ${where}`,
        desc: `“${text.length > 80 ? `${text.slice(0, 80)}…` : text}”`,
        go: isTask ? `tarefas?task=${note.task_id}&tab=comments` : `funnel?opp=${note.opportunity_id}&tab=atualizacoes`,
      })
    })
    opps.forEach(opportunity => {
      const sla = slaForLead(opportunity)
      if (sla.state === 'late') list.push({
        k: `sla-${opportunity.id}`, type: '1ª resposta', color: C.red || '#EF4444', icon: I.warn,
        title: itemLabel(opportunity), desc: `${sla.minutes} min sem resposta · alvo ${SLA_CONFIG.targetMin} min`, go: 'funnel',
      })
    })
    g.atrasadas.forEach(task => list.push({
      k: `task-${task.id}`, type: 'Tarefa atrasada', color: C.red || '#EF4444', icon: I.warn,
      title: task.title || 'Tarefa sem título',
      desc: `${task.patients?.full_name || task.opportunities?.title || 'Pendência do CRM'} · venceu em ${shortDate(task.due_date)}`,
      go: 'tarefas',
    }))
    opps.filter(opportunity => !opportunity.responsible_user_id).forEach(opportunity => list.push({
      k: `owner-${opportunity.id}`, type: 'Sem responsável', color: C.green || '#10B981', icon: I.user,
      title: itemLabel(opportunity), desc: 'Distribua este lead para a equipe', go: 'funnel',
    }))
    opps.forEach(opportunity => {
      const days = daysSince(opportunity.stage_entered_at) || 0
      if (days >= STALE_DAYS) list.push({
        k: `stale-${opportunity.id}`, type: 'Parada no funil', color: C.yellow || '#F59E0B', icon: I.clock,
        title: itemLabel(opportunity), desc: `${days} dias em ${stageLabel(opportunity.stage)}`, go: 'funnel',
      })
    })
    return list
  }, [tasks, opps, mentions, teamLabel, user?.id])
  const unreadAlerts = useMemo(() => alerts.filter(alert => !readKeys.includes(alert.k)), [alerts, readKeys])
  const total = unreadAlerts.length
  const groupedAlerts = useMemo(() => Object.values(unreadAlerts.reduce((groups, alert) => {
    const group = groups[alert.type] || { ...alert, items: [] }
    group.items.push(alert)
    groups[alert.type] = group
    return groups
  }, {})), [unreadAlerts])

  async function markAllRead() {
    const keys = alerts.map(alert => alert.k)
    const result = await saveWorkspacePreferences(effectiveUserId, user.id, { notification_state: { crm: keys } })
    if (result.error || !result.persisted) { setSaveError('Os alertas NÃO foram marcados como lidos. Tente novamente.'); return }
    setSaveError('')
    setReadKeys(keys)
    setNotificationState({ ...notificationState, crm: keys })
  }

  return { groupedAlerts, total, saveError, markAllRead }
}

export function NotificationBell({ data, summary, onNavigate, canFinance = true }) {
  const fin = useFinancialAlerts(data, summary)
  const crm = useCrmAlerts()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  const finTotal = canFinance ? fin.total : 0
  const total = finTotal + crm.total
  const dangerCount = (canFinance ? fin.dangerCount : 0) + crm.groupedAlerts.filter(a => a.color === (C.red || '#EF4444')).reduce((s, a) => s + a.items.length, 0)
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
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    background: C.card,
    border: `1px solid ${C.borderBright}`,
    borderRadius: 14,
    boxShadow: '0 18px 44px -14px rgba(0,0,0,.6)',
  }

  return (
    <div ref={triggerRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={total === 0 ? 'Sem alertas' : `${total} alerta(s)`}
        aria-label="Notificações"
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
        <Ico d={I.bell} size={16} />
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
        <div ref={panelRef} role="dialog" aria-label="Notificações" data-testid="notification-popover" style={panelStyle}>
          <div style={{ flex: '0 0 auto', padding: '12px 14px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Notificações</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: total === 0 ? C.green : dangerCount > 0 ? C.red : C.yellow }}>
              {total === 0 ? '● Tudo em ordem' : `${total} não lida${total > 1 ? 's' : ''}`}
            </span>
          </div>
          <div data-testid="notification-list" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', scrollbarGutter: 'stable' }}>
            {canFinance && (
              <section>
                <div style={{ padding: '8px 14px 6px', marginTop: 6, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: C.textDim }}>Financeiro</span>
                  {fin.total > 0 && <button type="button" onClick={fin.markAllRead} style={{ border: 0, background: 'transparent', color: C.accent, cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>Marcar lidos</button>}
                </div>
                {fin.saveError && <div role="alert" style={{ padding: '4px 14px 8px', color: C.red, fontSize: 11 }}>{fin.saveError}</div>}
                {fin.total === 0
                  ? <div style={{ padding: '10px 14px 16px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>Nenhum alerta financeiro no momento.</div>
                  : fin.visibleAlerts.map((alert, i) => (
                    <div
                      key={alert.key}
                      onClick={() => { if (alert.link && typeof onNavigate === 'function') { onNavigate(alert.link); setOpen(false) } }}
                      style={{
                        padding: '10px 14px',
                        borderBottom: i < fin.visibleAlerts.length - 1 ? `1px solid ${C.border}22` : 'none',
                        borderLeft: `3px solid ${alert.level === 'danger' ? C.red : C.yellow}`,
                        cursor: alert.link ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: alert.level === 'danger' ? C.red : C.yellow, marginBottom: 2 }}>{alert.title}</div>
                      <div style={{ fontSize: 11, color: C.textDim }}>{alert.body}</div>
                    </div>
                  ))}
              </section>
            )}

            <section>
              <div style={{ padding: '8px 14px 6px', marginTop: 6, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: C.textDim }}>CRM</span>
                {crm.total > 0 && <button type="button" onClick={crm.markAllRead} style={{ border: 0, background: 'transparent', color: C.accent, cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>Marcar lidas</button>}
              </div>
              {crm.saveError && <div role="alert" style={{ padding: '4px 14px 8px', color: C.red, fontSize: 11 }}>{crm.saveError}</div>}
              {crm.groupedAlerts.length === 0
                ? <div style={{ padding: '10px 14px 16px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>Tudo em dia por aqui.</div>
                : <div data-testid="crm-alerts-list">
                  {crm.groupedAlerts.map(a => (
                    <div key={a.k} data-testid="crm-alert-item" onClick={() => { setOpen(false); onNavigate?.(a.go) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}>
                      <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: a.color + '22', color: a.color, flexShrink: 0 }}><Ico d={a.icon} size={16} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ marginBottom: 2, color: a.color, fontSize: 9, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase' }}>{a.type} · {a.items.length}</div>
                        <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>{a.items.map(item => <div key={item.k} data-testid={item.k.startsWith('mention-') ? 'crm-alert-mention' : undefined}
                          // Cada menção leva à SUA oportunidade (os demais alertas seguem indo para a tela do grupo).
                          onClick={item.go !== a.go ? (e => { e.stopPropagation(); setOpen(false); onNavigate?.(item.go) }) : undefined}
                          style={{ color: C.text, fontSize: 11.5, fontWeight: 650, padding: '3px 0', borderBottom: `1px solid ${C.border}66` }}>{item.title}<span style={{ color: C.textDim, fontWeight: 500 }}> · {item.desc}</span></div>)}</div>
                      </div>
                    </div>
                  ))}
                </div>}
            </section>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
