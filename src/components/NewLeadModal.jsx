import { useEffect, useState } from 'react'
import { C } from '../theme.js'
import { Modal, Btn, FInput } from './UI.jsx'
import { createManualLead } from '../lib/opportunityActions.js'

// Lead manual: cria contato mínimo + oportunidade sem exigir paciente pré-cadastrado.
// Só o essencial — nome/telefone + procedimento de interesse, origem, responsável, valor.
const PROCEDURES = ['Rinoplastia', 'Mamoplastia', 'Abdominoplastia', 'Lipoaspiração', 'Blefaroplastia', 'Lifting facial', 'Prótese de mama', 'Outro']
const SOURCES = ['Instagram', 'Indicação', 'WhatsApp', 'Google', 'Facebook', 'Site', 'Outro']

export function NewLeadModal({ open, onClose, ownerId, members, stage = 'primeiro_contato', onCreated }) {
  const [form, setForm] = useState({ name: '', phone: '', title: '', source: '', responsible: '', value: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Ao abrir, zera formulário e erro (não arrasta estado de uma abertura anterior).
  useEffect(() => {
    if (open) { setForm({ name: '', phone: '', title: '', source: '', responsible: '', value: '' }); setError(null) }
  }, [open])

  const canSave = !!(form.name.trim() || form.phone.trim())
  const memberOpts = [{ v: '', l: 'Sem responsável' }, ...(members || []).map(m => ({ v: m.user_id, l: m.member_email || m.user_id }))]

  async function save() {
    if (!canSave || saving) return
    setSaving(true); setError(null)
    const res = await createManualLead(ownerId, {
      name: form.name, phone: form.phone, title: form.title,
      source: form.source, value: form.value, responsibleUserId: form.responsible, stage,
    })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    setForm({ name: '', phone: '', title: '', source: '', responsible: '', value: '' })
    onCreated(res.opp)
  }

  const hint = { fontSize: 11, color: C.textDim }
  return (
    <Modal open={open} onClose={onClose} title="Novo lead" width={480}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 12.5, color: C.textSub, marginTop: -4 }}>Só o essencial — o resto completa depois. O lead cai no funil em <strong style={{ color: C.text }}>Primeiro contato</strong>.</div>
        <FInput label="Nome" value={form.name} onChange={v => set('name', v)} placeholder="Nome do lead" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <FInput label="WhatsApp / Telefone" value={form.phone} onChange={v => set('phone', v)} placeholder="(51) 9...." />
          <FInput label="Valor estimado" type="number" value={form.value} onChange={v => set('value', v)} placeholder="R$ 0,00" />
        </div>
        <FInput label="Procedimento de interesse" value={form.title} onChange={v => set('title', v)}
          options={PROCEDURES.map(p => ({ v: p, l: p }))} creatable placeholder="Ex.: Rinoplastia" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <FInput label="Origem" value={form.source} onChange={v => set('source', v)}
            options={SOURCES.map(s => ({ v: s, l: s }))} creatable placeholder="Instagram, indicação…" />
          <FInput label="Responsável" value={form.responsible} onChange={v => set('responsible', v)} options={memberOpts} />
        </div>
        {error && <div style={{ color: C.red || '#ef4444', fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
          <span style={hint}>{form.phone.trim() ? 'Se o telefone já for paciente, o lead é anexado a ele.' : ''}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn onClick={save} disabled={saving || !canSave}>{saving ? 'Criando…' : 'Criar lead'}</Btn>
          </div>
        </div>
      </div>
    </Modal>
  )
}
