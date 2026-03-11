import { useState } from 'react'
import { C, base } from '../theme.js'
import { fmt, uid } from '../utils.js'
import { useMetrics } from '../useMetrics.js'
import { Card, Btn, FInput, Modal, ConfirmModal } from './UI.jsx'

const COLORS = ['#0EA5E9', '#10B981', '#F97316', '#EC4899', '#8B5CF6', '#F59E0B', '#22C55E', '#EF4444']

export function Plans({ data, setData }) {
  const empty = { name:'', price:0, durationHours:3, color:C.accent, desc:'', checklist:'' }
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const m = useMetrics(data)
  const procedureMap = new Map(m.byProcedure.map(item => [item.id, item]))

  const openAdd = () => {
    setForm({ ...empty, id:uid() })
    setEditing(null)
    setShowModal(true)
  }

  const openEdit = procedure => {
    setForm({
      ...procedure,
      checklist:Array.isArray(procedure.checklist) ? procedure.checklist.join('\n') : '',
    })
    setEditing(procedure.id)
    setShowModal(true)
  }

  const save = () => {
    if (!form.name) return
    const checklist = form.checklist ? form.checklist.split('\n').map(item => item.trim()).filter(Boolean) : []
    const nextRecord = { ...form, checklist }

    setData(current => ({
      ...current,
      procedures: editing
        ? current.procedures.map(item => item.id === editing ? { ...nextRecord, id:editing } : item)
        : [...current.procedures, { ...nextRecord, id:form.id || uid() }],
    }))
    setShowModal(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'flex-end' }}><Btn onClick={openAdd}>+ Novo Procedimento</Btn></div>

      {data.procedures.length === 0 && (
        <Card>
          <p style={{ color:C.textDim, textAlign:'center', padding:'32px 0', fontSize:14 }}>
            Nenhum procedimento cadastrado. Clique em "+ Novo Procedimento".
          </p>
        </Card>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:16 }}>
        {data.procedures.map(procedure => {
          const procedureStats = procedureMap.get(procedure.id)
          const count = procedureStats?.count || 0
          const revenue = procedureStats?.revenue || 0
          const checklist = Array.isArray(procedure.checklist) ? procedure.checklist : []

          return (
            <Card key={procedure.id} glow={procedure.color+'25'} style={{ borderTop:`3px solid ${procedure.color}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
                <h3 style={{ margin:0, fontSize:20, fontWeight:800, color:procedure.color }}>{procedure.name}</h3>
                <div style={{ display:'flex', gap:8 }}>
                  <Btn variant="ghost" onClick={() => openEdit(procedure)} style={{ padding:'5px 10px', fontSize:12 }}>Editar</Btn>
                  <Btn variant="danger" onClick={() => setConfirmId(procedure.id)} style={{ padding:'5px 10px', fontSize:12 }}>Excluir</Btn>
                </div>
              </div>
              <div style={{ fontSize:32, fontWeight:800, color:C.text, marginBottom:4 }}>
                {fmt(procedure.price)}
              </div>
              <div style={{ fontSize:12, color:C.textDim, marginBottom:10 }}>{procedure.durationHours || 0}h estimadas de sala / equipe</div>
              {procedure.desc && <p style={{ color:C.textSub, fontSize:13, margin:'8px 0 16px' }}>{procedure.desc}</p>}
              {checklist.length > 0 && (
                <ul style={{ listStyle:'none', padding:0, margin:'0 0 16px', display:'flex', flexDirection:'column', gap:6 }}>
                  {checklist.map((item, index) => (
                    <li key={index} style={{ fontSize:13, color:C.textSub, display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ color:procedure.color, fontSize:12 }}>✓</span>{item}
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:14, display:'flex', gap:24 }}>
                <div>
                  <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>Cirurgias</div>
                  <div style={{ fontSize:22, fontWeight:700, color:C.text }}>{count}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>Valor projetado</div>
                  <div style={{ fontSize:22, fontWeight:700, color:procedure.color }}>{fmt(revenue)}</div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <Modal open={showModal} onClose={() => setShowModal(false)} title={editing ? 'Editar Procedimento' : 'Novo Procedimento'}>
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <FInput label="Nome do procedimento" required value={form.name} onChange={value => setForm(current => ({ ...current, name:value }))} placeholder="Ex: Mamoplastia" />
          <FInput label="Preço base (R$)" value={form.price} onChange={value => setForm(current => ({ ...current, price:value }))} type="number" placeholder="0" />
          <FInput label="Duração estimada (horas)" value={form.durationHours} onChange={value => setForm(current => ({ ...current, durationHours:value }))} type="number" placeholder="3" />
          <FInput label="Descrição" value={form.desc} onChange={value => setForm(current => ({ ...current, desc:value }))} placeholder="Indicação, pacote ou observações" />
          <div>
            <label style={base.label}>Checklist / Itens inclusos</label>
            <textarea
              value={form.checklist}
              onChange={event => setForm(current => ({ ...current, checklist:event.target.value }))}
              placeholder={'Anestesia\nHospital\nRetornos'}
              rows={4}
              style={{ ...base.input, resize:'vertical', lineHeight:1.6 }}
            />
          </div>
          <div>
            <label style={base.label}>Cor do procedimento</label>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              {COLORS.map(color => (
                <button
                  key={color}
                  onClick={() => setForm(current => ({ ...current, color }))}
                  style={{ width:32, height:32, borderRadius:8, background:color, border:form.color === color ? '3px solid #fff' : '3px solid transparent', cursor:'pointer' }}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={event => setForm(current => ({ ...current, color:event.target.value }))}
                style={{ width:32, height:32, borderRadius:8, border:'none', cursor:'pointer', padding:2, background:'transparent' }}
                title="Cor personalizada"
              />
            </div>
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:8 }}>
            <Btn variant="ghost" onClick={() => setShowModal(false)}>Cancelar</Btn>
            <Btn onClick={save} disabled={!form.name}>{editing ? 'Salvar' : 'Criar procedimento'}</Btn>
          </div>
        </div>
      </Modal>

      <ConfirmModal open={!!confirmId} onClose={() => setConfirmId(null)} onConfirm={() => setData(current => ({ ...current, procedures:current.procedures.filter(item => item.id !== confirmId) }))} />
    </div>
  )
}
