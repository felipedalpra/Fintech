// Menu "+" do cabeçalho da tabela do CRM: mostrar/ocultar, reordenar e definir largura das colunas,
// criar e configurar colunas personalizadas. Campos do sistema não podem ser excluídos; colunas
// personalizadas são arquivadas (os valores gravados permanecem nas oportunidades).
import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { Modal, Btn } from './UI.jsx'
import { Ico, ICONS } from './CrmCells.jsx'
import { CUSTOM_FIELD_TYPES, compatibleFieldTypes, nextOptionColor, validateFieldDraft } from '../lib/crmWorkspace.js'

export function CrmColumnsMenu({ columns, canManage, fieldsAvailable, onToggleHidden, onMoveColumn, onSetWidth, onNewField, onEditField, onDone }) {
  const s = {
    head: { fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: C.textDim, padding: '6px 8px 4px' },
    row: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 8 },
    iconBtn: { border: 'none', background: 'transparent', color: C.textSub, cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 3, borderRadius: 6 },
    width: { width: 54, fontSize: 11.5, padding: '3px 5px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontFamily: 'inherit' },
    note: { fontSize: 11.5, color: C.textDim, padding: '6px 8px', lineHeight: 1.45 },
  }
  const movable = columns.filter(c => !c.fixed)
  return (
    <div>
      {canManage && fieldsAvailable && (
        <button type="button" data-testid="crm-new-column" onClick={() => { onDone?.(); onNewField() }}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', marginBottom: 4, borderRadius: 9, border: `1.5px dashed ${C.accent}`, background: C.accent + '12', color: C.accent, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
          <Ico d={ICONS.plus} size={14} sw={2.6} />Nova coluna
        </button>
      )}
      {!fieldsAvailable && <div style={s.note}>Colunas personalizadas ficam disponíveis depois que a atualização do banco do CRM for aplicada.</div>}
      {fieldsAvailable && !canManage && <div style={s.note}>Somente Administrador e Gestão criam ou alteram colunas personalizadas.</div>}
      <div style={s.head}>Colunas</div>
      {columns.map(col => {
        const i = movable.indexOf(col)
        return (
          <div key={col.id} style={s.row}>
            <input type="checkbox" checked={!col.hidden} disabled={col.fixed} aria-label={`Mostrar ${col.label}`}
              onChange={() => onToggleHidden(col.id)} style={{ accentColor: C.accent, cursor: col.fixed ? 'not-allowed' : 'pointer' }} />
            <span style={{ flex: 1, fontSize: 12.5, color: col.hidden ? C.textDim : C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {col.label}{col.fixed && <span style={{ color: C.textDim }}> · fixa</span>}{col.custom && <span style={{ color: C.textDim }}> · personalizada</span>}
            </span>
            <input type="number" min={72} max={640} step={10} aria-label={`Largura de ${col.label}`} title="Largura (px)" defaultValue={col.width}
              key={`${col.id}-${col.width}`}
              onBlur={e => { const w = Number(e.target.value); if (w && w !== col.width) onSetWidth(col.id, w) }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} style={s.width} />
            {!col.fixed && <>
              <button type="button" aria-label={`Mover ${col.label} para a esquerda`} disabled={i <= 0} onClick={() => onMoveColumn(col.id, -1)} style={{ ...s.iconBtn, opacity: i <= 0 ? 0.3 : 1 }}><Ico d={ICONS.arrowUp} size={13} /></button>
              <button type="button" aria-label={`Mover ${col.label} para a direita`} disabled={i >= movable.length - 1} onClick={() => onMoveColumn(col.id, 1)} style={{ ...s.iconBtn, opacity: i >= movable.length - 1 ? 0.3 : 1 }}><Ico d={ICONS.arrowDown} size={13} /></button>
            </>}
            {col.custom && canManage && (
              <button type="button" aria-label={`Configurar ${col.label}`} onClick={() => { onDone?.(); onEditField(col.field) }} style={s.iconBtn}><Ico d={ICONS.settings} size={13} /></button>
            )}
          </div>
        )
      })}
      <div style={s.note}>Arraste o cabeçalho para reordenar e a borda dele para mudar a largura.</div>
    </div>
  )
}

// Modal de criar/editar coluna personalizada.
export function CrmFieldEditor({ open, field, onClose, onSave, onArchive }) {
  const isEdit = Boolean(field?.id)
  const [draft, setDraft] = useState({ label: '', field_type: 'text', options: [] })
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null); setSaving(false); setConfirmArchive(false)
    setDraft(field?.id
      ? { label: field.label, field_type: field.field_type, options: (field.options || []).map(o => ({ ...o })) }
      : { label: '', field_type: 'text', options: [] })
  }, [open, field])

  const needsOptions = ['status', 'select', 'multiselect'].includes(draft.field_type)
  const typeChoices = isEdit ? CUSTOM_FIELD_TYPES.filter(t => compatibleFieldTypes(field.field_type).includes(t.type)) : CUSTOM_FIELD_TYPES

  function setOption(i, patch) {
    setDraft(d => ({ ...d, options: d.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }))
  }
  function addOption() {
    setDraft(d => ({ ...d, options: [...d.options, { id: crypto.randomUUID(), label: '', color: nextOptionColor(d.options.length) }] }))
  }
  function removeOption(i) {
    setDraft(d => ({ ...d, options: d.options.filter((_, j) => j !== i) }))
  }

  async function save() {
    const v = validateFieldDraft(draft)
    if (v.error) { setError(v.error); return }
    setSaving(true); setError(null)
    const res = await onSave(v.field)
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    onClose()
  }

  async function archive() {
    setSaving(true); setError(null)
    const res = await onArchive(field)
    setSaving(false)
    if (res?.error) { setError(res.error); return }
    onClose()
  }

  const input = { ...base.input, fontSize: 13 }
  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Configurar coluna · ${field.label}` : 'Nova coluna'} width={480} trackDirty={false}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label htmlFor="crm-field-label" style={base.label}>Nome da coluna</label>
          <input id="crm-field-label" autoFocus value={draft.label} maxLength={60} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))}
            placeholder="Ex.: Indicação, Valor do sinal…" style={input} />
        </div>
        <div>
          <label htmlFor="crm-field-type" style={base.label}>Tipo</label>
          <select id="crm-field-type" value={draft.field_type} onChange={e => setDraft(d => ({ ...d, field_type: e.target.value, options: ['status', 'select', 'multiselect'].includes(e.target.value) && d.options.length === 0 ? [{ id: crypto.randomUUID(), label: '', color: nextOptionColor(0) }] : d.options }))} style={input}>
            {typeChoices.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
          </select>
          {isEdit && <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>O tipo só muda para tipos compatíveis, para não invalidar valores já preenchidos.</div>}
        </div>
        {needsOptions && (
          <div>
            <span style={base.label}>Opções</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {draft.options.map((o, i) => (
                <div key={o.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input type="color" value={o.color || '#3b82f6'} aria-label={`Cor da opção ${i + 1}`} onChange={e => setOption(i, { color: e.target.value })}
                    style={{ width: 34, height: 32, padding: 0, border: `1px solid ${C.border}`, borderRadius: 8, background: 'transparent', cursor: 'pointer' }} />
                  <input value={o.label} aria-label={`Nome da opção ${i + 1}`} onChange={e => setOption(i, { label: e.target.value })} placeholder={`Opção ${i + 1}`} style={{ ...input, flex: 1 }} />
                  <button type="button" aria-label={`Remover opção ${i + 1}`} onClick={() => removeOption(i)}
                    style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.textSub, borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
                    <Ico d={ICONS.x} size={13} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addOption}
                style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent', color: C.accent, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Ico d={ICONS.plus} size={12} />Adicionar opção
              </button>
              {isEdit && <div style={{ fontSize: 11, color: C.textDim }}>Remover uma opção não apaga o que já foi gravado — essas células ficam sem rótulo até serem editadas.</div>}
            </div>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.45 }}>
          Colunas personalizadas são para dados comerciais. Não use para informações clínicas — prontuário e anamnese ficam na área Clínica.
        </div>
        {error && <div role="alert" style={{ color: C.red, fontSize: 12.5 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            {isEdit && !confirmArchive && <Btn variant="ghost" onClick={() => setConfirmArchive(true)} disabled={saving}>Remover coluna</Btn>}
            {isEdit && confirmArchive && <Btn variant="danger" onClick={archive} disabled={saving}>Confirmar remoção</Btn>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn onClick={save} disabled={saving}>{saving ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar coluna'}</Btn>
          </div>
        </div>
        {confirmArchive && <div style={{ fontSize: 11.5, color: C.textSub }}>A coluna some da tabela para toda a clínica. Os valores já preenchidos continuam guardados nas oportunidades.</div>}
      </div>
    </Modal>
  )
}
