import { useEffect, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Btn, FInput } from './UI.jsx'

// Config (admin) da régua de follow-up: modelos de tarefa por estágio.
// A criação das tarefas é feita por trigger no banco; aqui só administramos as regras.
// (Mesma lista de estágios do pipeline — config simples, mantida local.)
const STAGES = [
  { key: 'primeiro_contato', label: 'Primeiro Contato' },
  { key: 'consulta_agendada', label: 'Consulta Agendada' },
  { key: 'consultado', label: 'Consultado' },
  { key: 'orcamento_enviado', label: 'Orçamento Enviado' },
  { key: 'reserva_paga', label: 'Reserva Paga' },
  { key: 'follow_up', label: 'Follow-up' },
]
const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.key, s.label]))

export function FollowupRules() {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id

  const [rules, setRules] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState({ stage: 'consulta_agendada', title: '', offset_days: 0, assigned_user_id: '' })
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true); setError(null)
    const [rRes, mRes] = await Promise.all([
      supabase.from('followup_rules').select('id, stage, title, offset_days, assigned_user_id, active').order('created_at', { ascending: true }),
      supabase.from('clinic_members').select('user_id, member_email').order('created_at', { ascending: true }),
    ])
    if (rRes.error) { setError(rRes.error.message); setLoading(false); return }
    setRules(rRes.data ?? [])
    setMembers((mRes.data ?? []).filter(m => m.user_id))
    setLoading(false)
  }
  useEffect(() => { if (effectiveUserId) load() }, [effectiveUserId])

  const memberLabel = Object.fromEntries(members.map(m => [m.user_id, m.member_email || m.user_id]))

  async function addRule() {
    if (!draft.title.trim() || saving) return
    setSaving(true); setError(null)
    const { data, error: err } = await supabase.from('followup_rules').insert({
      user_id: effectiveUserId, stage: draft.stage, title: draft.title.trim(),
      offset_days: Number(draft.offset_days) || 0, assigned_user_id: draft.assigned_user_id || null, active: true,
    }).select('id, stage, title, offset_days, assigned_user_id, active').single()
    setSaving(false)
    if (err) { setError(err.message); return }
    setRules(r => [...r, data])
    setDraft({ stage: draft.stage, title: '', offset_days: 0, assigned_user_id: '' })
  }

  async function toggle(rule) {
    const prev = rules
    setRules(r => r.map(x => (x.id === rule.id ? { ...x, active: !x.active } : x)))
    const { error: err } = await supabase.from('followup_rules').update({ active: !rule.active }).eq('id', rule.id)
    if (err) { setRules(prev); setError(err.message) }
  }
  async function remove(rule) {
    const prev = rules
    setRules(r => r.filter(x => x.id !== rule.id))
    const { error: err } = await supabase.from('followup_rules').delete().eq('id', rule.id)
    if (err) { setRules(prev); setError(err.message) }
  }

  if (loading) return <div style={{ color: C.textSub, fontSize: 13, padding: 20 }}>Carregando régua…</div>

  const byStage = STAGES.map(s => ({ ...s, items: rules.filter(r => r.stage === s.key) })).filter(s => s.items.length)

  const s = {
    intro: { fontSize: 13, color: C.textSub, marginBottom: 16, lineHeight: 1.4 },
    stageBlock: { marginBottom: 16 },
    stageTitle: { fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 6 },
    row: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.border}` },
    title: active => ({ flex: 1, fontSize: 13, color: active ? C.text : C.textDim }),
    when: { fontSize: 11, color: C.textSub, whiteSpace: 'nowrap' },
    who: { fontSize: 10, color: C.textSub, whiteSpace: 'nowrap' },
    off: { background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 8px', fontSize: 10, color: C.textSub, cursor: 'pointer', fontFamily: 'inherit' },
    del: { background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 14, padding: 0 },
    form: { marginTop: 20, padding: 14, border: `1px solid ${C.border}`, borderRadius: 10, background: C.surface, display: 'flex', flexDirection: 'column', gap: 12 },
  }

  return (
    <div>
      <div style={s.intro}>
        Quando uma oportunidade <strong>entra</strong> num estágio, as tarefas abaixo são criadas automaticamente
        (vencimento = dia da entrada + os dias configurados). Vale para qualquer forma de mover — manual, arrastar ou IA.
      </div>
      {error && <div style={{ color: C.red || '#ef4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}

      {byStage.length === 0
        ? <div style={{ color: C.textDim, fontSize: 13, padding: '8px 0 16px' }}>Nenhuma regra ainda. Crie a primeira abaixo.</div>
        : byStage.map(st => (
            <div key={st.key} style={s.stageBlock}>
              <div style={s.stageTitle}>Ao entrar em {st.label}</div>
              {st.items.map(r => (
                <div key={r.id} style={s.row}>
                  <span style={s.title(r.active)}>{r.title}</span>
                  <span style={s.when}>+{r.offset_days}d</span>
                  {r.assigned_user_id && <span style={s.who}>{memberLabel[r.assigned_user_id] || '—'}</span>}
                  <button type="button" style={s.off} onClick={() => toggle(r)}>{r.active ? 'ativa' : 'inativa'}</button>
                  <button type="button" style={s.del} onClick={() => remove(r)} title="Excluir">×</button>
                </div>
              ))}
            </div>
          ))}

      <div style={s.form}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Nova regra</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <FInput label="Estágio" value={draft.stage} onChange={v => setDraft(d => ({ ...d, stage: v }))}
            options={STAGES.map(st => ({ v: st.key, l: st.label }))} />
          <FInput label="Vencimento (+dias)" type="number" value={draft.offset_days} onChange={v => setDraft(d => ({ ...d, offset_days: v }))} />
        </div>
        <FInput label="Tarefa" value={draft.title} onChange={v => setDraft(d => ({ ...d, title: v }))} placeholder="Ex.: Ligar pra confirmar" />
        <FInput label="Responsável (opcional)" value={draft.assigned_user_id} onChange={v => setDraft(d => ({ ...d, assigned_user_id: v }))}
          options={[{ v: '', l: 'Sem responsável' }, ...members.map(m => ({ v: m.user_id, l: m.member_email || m.user_id }))]} />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Btn onClick={addRule} disabled={saving || !draft.title.trim()}>{saving ? 'Salvando…' : 'Adicionar regra'}</Btn>
        </div>
      </div>
    </div>
  )
}
