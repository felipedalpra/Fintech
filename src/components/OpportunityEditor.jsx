import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { Modal, Btn, FInput } from './UI.jsx'
import { PatientSelector } from './PatientSelector.jsx'
import { OpportunityTasks } from './OpportunityTasks.jsx'
import { OpportunityTimeline } from './OpportunityTimeline.jsx'
import { createOpportunity, updateOpportunity, setOpportunityOutcome } from '../lib/opportunityActions.js'

// Modal de criar/editar oportunidade (+ fechar como ganho/perdido).
// Ao editar, ganha abas: Dados / Tarefas / Timeline.
// Estágio só é escolhido na criação; depois muda por mover/arrastar (RPC auditada).
const BLANK = { patient_id: '', patient_name: '', title: '', value: '', stage: '', source: '', responsible_user_id: '', tags: [] }

export function OpportunityEditor({ open, onClose, opp, stages, members, ownerId, userId, onSaved }) {
  const isEdit = !!opp
  const [tab, setTab] = useState('dados')
  const [form, setForm] = useState(BLANK)
  const [tagDraft, setTagDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [losing, setLosing] = useState(false)
  const [lostReason, setLostReason] = useState('')

  useEffect(() => {
    if (!open) return
    setError(null); setLosing(false); setLostReason(''); setTagDraft(''); setTab('dados')
    if (opp) {
      setForm({
        patient_id: opp.patient_id || '', patient_name: opp.patients?.full_name || '',
        title: opp.title && opp.title !== 'Oportunidade' ? opp.title : '',
        value: opp.value ?? '', stage: opp.stage || '', source: opp.source || '',
        responsible_user_id: opp.responsible_user_id || '', tags: Array.isArray(opp.tags) ? opp.tags : [],
      })
    } else {
      setForm({ ...BLANK, stage: stages?.[0]?.key || 'primeiro_contato' })
    }
  }, [open, opp, stages])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function addTag() {
    const t = tagDraft.trim()
    if (!t || form.tags.includes(t)) { setTagDraft(''); return }
    set('tags', [...form.tags, t]); setTagDraft('')
  }

  async function save() {
    if (!form.patient_id) { setError('Selecione um paciente.'); return }
    setSaving(true); setError(null)
    const res = isEdit ? await updateOpportunity(opp.id, form) : await createOpportunity(ownerId, form)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onSaved(isEdit ? { updated: { id: opp.id, ...normalize(form) } } : { created: res.opp })
    onClose()
  }

  async function closeAs(status) {
    if (status === 'perdido' && !losing) { setLosing(true); return }
    setSaving(true); setError(null)
    const res = await setOpportunityOutcome(opp.id, status, lostReason)
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onSaved({ closed: opp.id })
    onClose()
  }

  const memberOpts = [{ v: '', l: 'Sem responsável' }, ...(members || []).map(m => ({ v: m.user_id, l: m.member_email || m.user_id }))]
  const sourceOpts = SOURCE_SUGGESTIONS.map(s => ({ v: s, l: s }))

  const tabBtn = active => ({
    padding: '6px 14px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
    background: active ? C.accent + '18' : 'transparent', color: active ? C.accent : C.textSub,
  })

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `${form.title || 'Oportunidade'} · ${form.patient_name || ''}` : 'Nova oportunidade'} width={520}>
      {isEdit && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
          <button type="button" style={tabBtn(tab === 'dados')} onClick={() => setTab('dados')}>Dados</button>
          <button type="button" style={tabBtn(tab === 'tarefas')} onClick={() => setTab('tarefas')}>Tarefas</button>
          <button type="button" style={tabBtn(tab === 'timeline')} onClick={() => setTab('timeline')}>Timeline</button>
        </div>
      )}

      {isEdit && tab === 'tarefas' && (
        <OpportunityTasks ownerId={ownerId} opportunityId={opp.id} patientId={opp.patient_id} members={members} userId={userId} />
      )}
      {isEdit && tab === 'timeline' && (
        <OpportunityTimeline ownerId={ownerId} opp={opp} userId={userId} />
      )}

      <div style={{ display: tab === 'dados' ? 'flex' : 'none', flexDirection: 'column', gap: 14 }}>
        {isEdit
          ? <div><label style={base.label}>Paciente</label>
              <div style={{ ...base.input, display: 'flex', alignItems: 'center', color: C.text }}>{form.patient_name || '—'}</div></div>
          : <PatientSelector userId={ownerId} value={form.patient_id} onChange={(id, name) => setForm(f => ({ ...f, patient_id: id, patient_name: name }))} />}

        <FInput label="Título" value={form.title} onChange={v => set('title', v)} placeholder="Ex.: Rinoplastia" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <FInput label="Valor" type="number" value={form.value} onChange={v => set('value', v)} placeholder="R$ 0,00" />
          {isEdit
            ? <div><label style={base.label}>Estágio</label>
                <div style={{ ...base.input, color: C.textSub }}>{stageLabel(stages, form.stage)}</div>
                <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>Arraste o card para mover</div></div>
            : <FInput label="Estágio" value={form.stage} onChange={v => set('stage', v)} options={(stages || []).map(s => ({ v: s.key, l: s.label }))} />}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <FInput label="Origem" value={form.source} onChange={v => set('source', v)} options={sourceOpts} creatable placeholder="Instagram, indicação…" />
          <FInput label="Responsável" value={form.responsible_user_id} onChange={v => set('responsible_user_id', v)} options={memberOpts} />
        </div>

        <div>
          <label style={base.label}>Tags</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {form.tags.map(t => (
              <span key={t} style={{ fontSize: 11, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 8px', color: C.textSub, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                {t}<button type="button" onClick={() => set('tags', form.tags.filter(x => x !== t))} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', padding: 0, fontSize: 13 }}>×</button>
              </span>
            ))}
          </div>
          <input value={tagDraft} onChange={e => setTagDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
            placeholder="Digite e Enter para adicionar" style={{ ...base.input, fontSize: 13 }} />
        </div>

        {losing && (
          <FInput label="Motivo da perda" value={lostReason} onChange={setLostReason}
            options={LOSS_REASONS.map(r => ({ v: r, l: r }))} placeholder="Selecione o motivo" />
        )}
        {error && <div style={{ color: C.red || '#ef4444', fontSize: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {isEdit && !losing && <>
              <Btn variant="ghost" onClick={() => closeAs('ganho')} disabled={saving}>✓ Ganho</Btn>
              <Btn variant="ghost" onClick={() => closeAs('perdido')} disabled={saving}>✗ Perdido</Btn>
            </>}
            {losing && <Btn variant="danger" onClick={() => closeAs('perdido')} disabled={saving}>Confirmar perda</Btn>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            {!losing && <Btn onClick={save} disabled={saving || !form.patient_id}>{saving ? 'Salvando…' : 'Salvar'}</Btn>}
          </div>
        </div>
      </div>
    </Modal>
  )
}

const SOURCE_SUGGESTIONS = ['Instagram', 'Indicação', 'WhatsApp', 'Google', 'Facebook', 'Site', 'Outro']
// Motivos de perda padronizados (alimentam o relatório de motivos no Painel de CRM).
const LOSS_REASONS = ['Achou caro', 'Adiou a decisão', 'Foi em outra clínica', 'Sumiu / sem resposta', 'Fechou com concorrente', 'Outro']

function stageLabel(stages, key) {
  return (stages || []).find(s => s.key === key)?.label || key || '—'
}

// Converte o form para o shape guardado no estado do pipeline (após editar).
function normalize(f) {
  const value = f.value === '' || f.value == null ? null : Number(f.value)
  return {
    title: (f.title || '').trim() || 'Oportunidade',
    value: Number.isFinite(value) ? value : null,
    source: (f.source || '').trim() || null,
    responsible_user_id: f.responsible_user_id || null,
    tags: Array.isArray(f.tags) ? f.tags : [],
  }
}
