// Configuração das etapas comerciais por clínica: nome, cor, ordem e probabilidade padrão.
// As CHAVES das etapas não mudam (automação do funil e histórico dependem delas).
import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { Modal, Btn } from './UI.jsx'
import { Ico, ICONS } from './CrmCells.jsx'
import { DEFAULT_STAGES, STAGE_KEYS } from '../lib/crmStages.js'
import { STAGE_PROB } from '../lib/crmMetrics.js'

export function CrmStageSettings({ open, stages, onClose, onSave, insertAfterKey = null }) {
  const [rows, setRows] = useState([])
  const [removed, setRemoved] = useState([])
  const [removeTarget, setRemoveTarget] = useState(null)
  const [newLabel, setNewLabel] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) { setRows(stages.map(s => ({ ...s }))); setRemoved([]); setRemoveTarget(null); setNewLabel(''); setError(null); setSaving(false) }
  }, [open, stages, insertAfterKey])

  function set(i, patch) { setRows(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x))) }
  function move(i, d) {
    setRows(r => {
      const n = [...r]
      const j = i + d
      if (j < 0 || j >= n.length) return r
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  }
  function restoreDefaults() {
    const fallback = DEFAULT_STAGES[0]?.key
    const customToRemove = rows.filter(r => !STAGE_KEYS.includes(r.key) && !String(r.key).startsWith('new_'))
      .map(r => ({ key: r.key, replacementKey: fallback }))
    if (customToRemove.length) setRemoved(v => [...v, ...customToRemove])
    setRows(DEFAULT_STAGES.map(s => ({ ...s, probability: Math.round((STAGE_PROB[s.key] || 0) * 1000) / 10 })))
    setRemoveTarget(null); setError(null)
  }

  function addStage() {
    const label = newLabel.trim()
    if (!label) { setError('Informe o nome da nova etapa.'); return }
    setRows(r => {
      const after = insertAfterKey ? r.findIndex(item => item.key === insertAfterKey) : -1
      const index = after >= 0 ? after + 1 : r.length
      const stage = { key: `new_${Date.now()}_${Math.random().toString(36).slice(2)}`, label, color: '#64748b', probability: 0, position: index, system: false, isNew: true }
      return [...r.slice(0, index), stage, ...r.slice(index)]
    })
    setNewLabel(''); setError(null)
  }

  function askRemove(stage) {
    if (rows.length <= 1) { setError('É necessário manter pelo menos uma etapa.'); return }
    setRemoveTarget({ key: stage.key, replacementKey: rows.find(r => r.key !== stage.key)?.key || '' })
    setError(null)
  }

  function confirmRemove() {
    if (!removeTarget?.replacementKey) { setError('Escolha para qual etapa as oportunidades serão movidas.'); return }
    const removedRow = rows.find(r => r.key === removeTarget.key)
    setRows(r => r.filter(x => x.key !== removeTarget.key))
    if (!removedRow?.isNew && !String(removeTarget.key).startsWith('new_')) setRemoved(v => [...v, removeTarget])
    setRemoveTarget(null)
  }

  async function save() {
    for (const r of rows) {
      if (!String(r.label || '').trim()) { setError('Toda etapa precisa de um nome.'); return }
      const p = Number(r.probability)
      if (!Number.isFinite(p) || p < 0 || p > 100) { setError(`Probabilidade de "${r.label}" deve estar entre 0 e 100.`); return }
    }
    setSaving(true); setError(null)
    const res = await onSave(rows.map(r => ({ key: r.key, label: r.label.trim(), color: r.color, probability: Number(r.probability) })))
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    onClose()
  }

  const input = { ...base.input, fontSize: 13, padding: '7px 9px' }
  return (
    <Modal open={open} onClose={onClose} title="Configurar etapas comerciais" width={560} trackDirty={false}>
      <p style={{ margin: '0 0 14px', fontSize: 12.5, color: C.textSub, lineHeight: 1.5 }}>
        Personalize nome, cor, ordem e probabilidade. Você também pode criar etapas próprias. Ao remover uma etapa,
        as oportunidades são movidas para a etapa escolhida e o histórico dessa movimentação é preservado.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 90px 64px', gap: 8, fontSize: 11, fontWeight: 800, color: C.textDim, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
        <span>Cor</span><span>Nome</span><span>Prob. %</span><span>Ordem</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r, i) => (
          <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 90px 64px', gap: 8, alignItems: 'center' }}>
            <input type="color" aria-label={`Cor de ${r.label}`} value={r.color} onChange={e => set(i, { color: e.target.value })}
              style={{ width: 36, height: 32, padding: 0, border: `1px solid ${C.border}`, borderRadius: 8, background: 'transparent', cursor: 'pointer' }} />
            <input aria-label={`Nome da etapa ${i + 1}`} value={r.label} maxLength={60} onChange={e => set(i, { label: e.target.value })} style={input} />
            <input aria-label={`Probabilidade de ${r.label}`} type="number" min={0} max={100} value={r.probability} onChange={e => set(i, { probability: e.target.value })} style={input} />
            <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              <button type="button" aria-label={`Subir ${r.label}`} disabled={i === 0} onClick={() => move(i, -1)} style={arrowBtn(i === 0)}><Ico d={ICONS.arrowUp} size={13} /></button>
              <button type="button" aria-label={`Descer ${r.label}`} disabled={i === rows.length - 1} onClick={() => move(i, 1)} style={arrowBtn(i === rows.length - 1)}><Ico d={ICONS.arrowDown} size={13} /></button>
              <button type="button" aria-label={`Excluir ${r.label}`} onClick={() => askRemove(r)} style={{ ...arrowBtn(false), color: C.red }}>×</button>
            </div>
          </div>
        ))}
      </div>
      {removeTarget && <div style={{ marginTop: 12, padding: 10, border: `1px solid ${C.yellow}66`, background: C.yellow + '12', borderRadius: 9, fontSize: 12.5, color: C.textSub }}>
        <div style={{ marginBottom: 8 }}>Mover oportunidades de <strong>{rows.find(r => r.key === removeTarget.key)?.label}</strong> para:</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select aria-label="Etapa de destino da exclusão" value={removeTarget.replacementKey} onChange={e => setRemoveTarget(v => ({ ...v, replacementKey: e.target.value }))} style={{ ...input, flex: 1 }}>
            {rows.filter(r => r.key !== removeTarget.key).map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <Btn onClick={confirmRemove} style={{ padding: '7px 10px', background: C.red }}>Excluir</Btn>
          <Btn variant="ghost" onClick={() => setRemoveTarget(null)} style={{ padding: '7px 10px' }}>Cancelar</Btn>
        </div>
      </div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <input aria-label="Nome da nova etapa" value={newLabel} maxLength={60} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addStage() }} placeholder="Nova etapa…" style={{ ...input, flex: 1 }} />
        <Btn variant="ghost" onClick={addStage}>+ Adicionar etapa</Btn>
      </div>
      {error && <div role="alert" style={{ color: C.red, fontSize: 12.5, marginTop: 10 }}>{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
        <Btn variant="ghost" onClick={restoreDefaults} disabled={saving}>Restaurar padrão</Btn>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar etapas'}</Btn>
        </div>
      </div>
    </Modal>
  )
}

function arrowBtn(disabled) {
  return { border: `1px solid ${C.border}`, background: C.surface, color: C.textSub, borderRadius: 7, width: 28, height: 30, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, display: 'grid', placeItems: 'center' }
}
