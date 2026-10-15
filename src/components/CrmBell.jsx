import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { groupTasksByDue } from '../lib/taskGroups.js'
import { slaForLead, SLA_CONFIG } from '../lib/slaBusinessTime.js'

// Sininho de CRM: alertas derivados dos dados atuais (sem tabela nova) — tarefas atrasadas,
// leads sem responsável e oportunidades paradas. Clicar leva pra tela do item.
const STALE_DAYS = 10

function daysSince(ts) {
  if (!ts) return null
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  return d >= 0 ? d : null
}
function Ico({ d, size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
}
const I = {
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
  warn: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  user: <><circle cx="9" cy="8" r="4" /><path d="M3 20a6 6 0 0 1 12 0M17 11h5M19.5 8.5v5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
}

export function CrmBell({ onNavigate }) {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id
  const [tasks, setTasks] = useState([])
  const [opps, setOpps] = useState([])
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!effectiveUserId) return
    let mounted = true
    async function load() {
      try {
        const [taskRes, oppRes] = await Promise.all([
          supabase.from('tasks').select('id, due_date, status').eq('user_id', effectiveUserId).eq('status', 'pendente'),
          supabase.from('opportunities').select('id, responsible_user_id, stage_entered_at, status, stage, created_at, first_response_at').eq('user_id', effectiveUserId).eq('status', 'aberto'),
        ])
        if (!mounted) return
        setTasks(taskRes.data ?? [])
        setOpps(oppRes.data ?? [])
      } catch { /* o sininho é não-crítico: se falhar, não mostra alerta e não quebra o topo */ }
    }
    load()
    return () => { mounted = false }
  }, [effectiveUserId])

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      const clickedTrigger = triggerRef.current?.contains(e.target)
      const clickedPanel = panelRef.current?.contains(e.target)
      if (!clickedTrigger && !clickedPanel) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const { alerts, total } = useMemo(() => {
    const g = groupTasksByDue(tasks)
    const atrasadas = g.atrasadas.length
    const semResp = opps.filter(o => !o.responsible_user_id).length
    const parados = opps.filter(o => (daysSince(o.stage_entered_at) || 0) >= STALE_DAYS).length
    const slaLate = opps.filter(o => slaForLead(o).state === 'late').length
    const list = []
    if (slaLate) list.push({ k: 'sla', color: C.red || '#EF4444', icon: I.warn, title: `${slaLate} lead${slaLate > 1 ? 's' : ''} sem 1ª resposta`, desc: `Passaram do alvo de ${SLA_CONFIG.targetMin} min`, go: 'funnel' })
    if (atrasadas) list.push({ k: 'atr', color: C.red || '#EF4444', icon: I.warn, title: `${atrasadas} tarefa${atrasadas > 1 ? 's' : ''} atrasada${atrasadas > 1 ? 's' : ''}`, desc: 'Resolva ou reagende', go: 'tarefas' })
    if (semResp) list.push({ k: 'sr', color: C.green || '#10B981', icon: I.user, title: `${semResp} lead${semResp > 1 ? 's' : ''} sem responsável`, desc: 'Distribua para a equipe', go: 'funnel' })
    if (parados) list.push({ k: 'pa', color: C.yellow || '#F59E0B', icon: I.clock, title: `${parados} oportunidade${parados > 1 ? 's' : ''} parada${parados > 1 ? 's' : ''}`, desc: `Há +${STALE_DAYS} dias no mesmo estágio`, go: 'funnel' })
    return { alerts: list, total: slaLate + atrasadas + semResp + parados } // badge = nº de itens, não de categorias
  }, [tasks, opps])

  const btn = { position: 'relative', width: 38, height: 38, borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, display: 'grid', placeItems: 'center', cursor: 'pointer', color: total ? C.text : C.textSub }
  const badge = { position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, borderRadius: 9, background: C.red || '#EF4444', color: '#fff', fontSize: 10, fontWeight: 800, display: 'grid', placeItems: 'center', padding: '0 4px', border: `2px solid ${C.bg}` }
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
    border: `1px solid ${C.borderBright || C.border}`,
    borderRadius: 14,
    boxShadow: '0 18px 44px -14px rgba(0,0,0,.6)',
  }

  return (
    <div ref={triggerRef} style={{ position: 'relative' }}>
      <button type="button" style={btn} onClick={() => setOpen(o => !o)} title="Alertas do CRM" aria-label="Alertas do CRM" aria-expanded={open} aria-haspopup="dialog">
        <Ico d={I.bell} size={19} />
        {total > 0 && <span style={badge}>{total}</span>}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={panelRef} role="dialog" aria-label="Alertas do CRM" data-testid="crm-alerts-popover" style={panelStyle}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 800, color: C.text }}>Alertas do CRM</div>
          {alerts.length === 0
            ? <div style={{ padding: '20px 14px', fontSize: 13, color: C.textSub, textAlign: 'center' }}>Tudo em dia por aqui. 🎉</div>
            : alerts.map(a => (
              <div key={a.k} onClick={() => { setOpen(false); onNavigate?.(a.go) }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: a.color + '22', color: a.color, flexShrink: 0 }}><Ico d={a.icon} size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: C.text }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: C.textSub, marginTop: 1 }}>{a.desc}</div>
                </div>
              </div>
            ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
