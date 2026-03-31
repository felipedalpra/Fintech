import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { C } from '../theme.js'
import { fmt, today } from '../utils.js'
import { Badge, Btn, Card, ConfirmModal, FInput, Modal } from './UI.jsx'
import { useToast } from '../context/ToastContext.jsx'

const EMPTY_FORM = {
  tipo:'despesa',
  descricao:'',
  valor:0,
  categoria:'outros',
  frequencia:'mensal',
  dia_execucao:5,
  data_inicio:today(),
  data_fim:'',
  auto_mark_as_paid:false,
  ativo:true,
}

const CATEGORIAS_DESPESA = ['aluguel', 'energia', 'internet', 'salarios', 'marketing', 'softwares', 'impostos', 'despesas_variaveis', 'outros']
const CATEGORIAS_RECEITA = ['consulta', 'cirurgia', 'contrato', 'aluguel_equipamento', 'outras_receitas']

export function Recurrences() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [rows, setRows] = useState([])
  const [openModal, setOpenModal] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [form, setForm] = useState(EMPTY_FORM)
  const [confirmState, setConfirmState] = useState(null)

  const categoryOptions = useMemo(() => {
    const source = form.tipo === 'receita' ? CATEGORIAS_RECEITA : CATEGORIAS_DESPESA
    return source.map(item => ({ v:item, l:labelize(item) }))
  }, [form.tipo])

  useEffect(() => {
    loadRecurrences()
  }, [])

  async function loadRecurrences() {
    setLoading(true)
    const { data, error } = await supabase
      .from('recorrencias')
      .select('*')
      .order('created_at', { ascending:false })

    if (error) {
      toast(error.message || 'Nao foi possivel carregar recorrencias.', 'warning')
      setRows([])
      setLoading(false)
      return
    }

    setRows(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  function openCreate() {
    setEditingId('')
    setForm({ ...EMPTY_FORM, data_inicio:today() })
    setOpenModal(true)
  }

  function openEdit(item) {
    setEditingId(item.id)
    setForm({
      tipo:item.tipo || 'despesa',
      descricao:item.descricao || '',
      valor:Number(item.valor || 0),
      categoria:item.categoria || 'outros',
      frequencia:item.frequencia || 'mensal',
      dia_execucao:Number(item.dia_execucao || 1),
      data_inicio:item.data_inicio || today(),
      data_fim:item.data_fim || '',
      auto_mark_as_paid:Boolean(item.auto_mark_as_paid),
      ativo:item.ativo !== false,
    })
    setOpenModal(true)
  }

  async function saveRecurrence() {
    if (!form.descricao.trim()) {
      toast('Informe a descricao da recorrencia.', 'warning')
      return
    }

    setSaving(true)

    const { data:userData } = await supabase.auth.getUser()
    const user = userData?.user
    if (!user) {
      setSaving(false)
      toast('Sessao invalida. Entre novamente.', 'warning')
      return
    }

    const payload = {
      user_id:user.id,
      tipo:form.tipo,
      descricao:form.descricao.trim(),
      valor:Number(form.valor || 0),
      categoria:form.categoria,
      frequencia:form.frequencia,
      dia_execucao:clampExecutionDay(form.dia_execucao, form.frequencia),
      data_inicio:form.data_inicio,
      data_fim:form.data_fim || null,
      auto_mark_as_paid:Boolean(form.auto_mark_as_paid),
      ativo:Boolean(form.ativo),
    }

    const query = editingId
      ? supabase.from('recorrencias').update(payload).eq('id', editingId)
      : supabase.from('recorrencias').insert(payload)

    const { error } = await query
    setSaving(false)

    if (error) {
      toast(error.message || 'Nao foi possivel salvar recorrencia.', 'warning')
      return
    }

    toast(editingId ? 'Recorrencia atualizada.' : 'Recorrencia criada.')
    setOpenModal(false)
    setEditingId('')
    await loadRecurrences()
  }

  async function toggleActive(item, nextState) {
    const { error } = await supabase
      .from('recorrencias')
      .update({ ativo:nextState })
      .eq('id', item.id)

    if (error) {
      toast(error.message || 'Nao foi possivel atualizar status.', 'warning')
      return
    }

    toast(nextState ? 'Recorrencia ativada.' : 'Recorrencia pausada.')
    await loadRecurrences()
  }

  async function deleteRecurrence(item) {
    const { error } = await supabase
      .from('recorrencias')
      .delete()
      .eq('id', item.id)

    if (error) {
      toast(error.message || 'Nao foi possivel excluir recorrencia.', 'warning')
      return
    }

    toast('Recorrencia removida.', 'warning')
    await loadRecurrences()
  }

  async function processNow() {
    setProcessing(true)

    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      if (!token) throw new Error('Sessao invalida. Entre novamente.')

      const response = await fetch('/api/recurrences/process', {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          Authorization:`Bearer ${token}`,
        },
        body:JSON.stringify({ referenceDate:today() }),
      })

      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`)

      const inserted = Number(json?.result?.inserted || 0)
      if (inserted > 0) {
        toast(`${inserted} lancamento(s) recorrente(s) gerado(s).`)
      } else {
        toast('Nenhum novo lancamento foi necessario para hoje.')
      }
      await loadRecurrences()
    } catch (error) {
      toast(error?.message || 'Nao foi possivel processar recorrencias.', 'warning')
    }

    setProcessing(false)
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <Card>
        <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <div>
            <h3 style={titleStyle}>Despesas e Receitas Recorrentes</h3>
            <p style={{ margin:'6px 0 0', color:C.textDim, fontSize:13 }}>
              Cadastre valores fixos e gere lancamentos automaticos sem duplicacao.
            </p>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <Btn variant="ghost" onClick={processNow} disabled={processing}>{processing ? 'Processando...' : 'Processar hoje'}</Btn>
            <Btn onClick={openCreate}>+ Nova recorrencia</Btn>
          </div>
        </div>
      </Card>

      <Card>
        {loading ? (
          <p style={{ margin:0, color:C.textDim, fontSize:13 }}>Carregando recorrencias...</p>
        ) : rows.length === 0 ? (
          <p style={{ margin:0, color:C.textDim, fontSize:13 }}>Nenhuma recorrencia cadastrada.</p>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', minWidth:940 }}>
              <thead>
                <tr>
                  {['Descricao', 'Tipo', 'Valor', 'Frequencia', 'Proxima execucao', 'Status', 'Auto pago', 'Acoes'].map(label => (
                    <th key={label} style={thStyle}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(item => {
                  const nextDate = getNextExecutionDate(item)
                  const distance = nextDate ? daysUntil(nextDate) : null
                  return (
                    <tr key={item.id} style={{ borderTop:`1px solid ${C.border}55` }}>
                      <td style={tdStyle}>
                        <div style={{ color:C.text, fontWeight:600 }}>{item.descricao}</div>
                        <div style={{ color:C.textDim, fontSize:12 }}>{labelize(item.categoria || 'outros')}</div>
                      </td>
                      <td style={tdStyle}><Badge color={item.tipo === 'receita' ? C.green : C.red}>{item.tipo}</Badge></td>
                      <td style={tdStyle}>{fmt(item.valor || 0)}</td>
                      <td style={tdStyle}>{labelize(item.frequencia || '')}</td>
                      <td style={tdStyle}>
                        {nextDate ? (
                          <>
                            <div style={{ color:C.text }}>{nextDate}</div>
                            <div style={{ color:C.textDim, fontSize:12 }}>Proxima cobranca em {distance} dia(s)</div>
                          </>
                        ) : (
                          <span style={{ color:C.textDim }}>Sem proxima execucao</span>
                        )}
                      </td>
                      <td style={tdStyle}><Badge color={item.ativo ? C.green : C.textDim}>{item.ativo ? 'ativo' : 'inativo'}</Badge></td>
                      <td style={tdStyle}>{item.auto_mark_as_paid ? 'Sim' : 'Nao'}</td>
                      <td style={tdStyle}>
                        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                          <Btn variant="ghost" onClick={() => openEdit(item)} style={{ padding:'6px 10px', fontSize:12 }}>Editar</Btn>
                          <Btn variant={item.ativo ? 'warn' : 'success'} onClick={() => toggleActive(item, !item.ativo)} style={{ padding:'6px 10px', fontSize:12 }}>
                            {item.ativo ? 'Pausar' : 'Ativar'}
                          </Btn>
                          <Btn variant="danger" onClick={() => setConfirmState(item)} style={{ padding:'6px 10px', fontSize:12 }}>Excluir</Btn>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={openModal} onClose={() => setOpenModal(false)} title={editingId ? 'Editar recorrencia' : 'Nova recorrencia'} width={620}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12 }}>
          <FInput label="Descricao" value={form.descricao} onChange={value => setForm(current => ({ ...current, descricao:value }))} />
          <FInput label="Tipo" value={form.tipo} onChange={value => setForm(current => ({ ...current, tipo:value, categoria:(value === 'receita' ? CATEGORIAS_RECEITA[0] : CATEGORIAS_DESPESA[0]) }))} options={[{ v:'despesa', l:'Despesa' }, { v:'receita', l:'Receita' }]} />
          <FInput label="Valor" type="number" value={form.valor} onChange={value => setForm(current => ({ ...current, valor:value }))} />
          <FInput label="Categoria" value={form.categoria} onChange={value => setForm(current => ({ ...current, categoria:value }))} options={categoryOptions} />
          <FInput label="Frequencia" value={form.frequencia} onChange={value => setForm(current => ({ ...current, frequencia:value }))} options={[{ v:'mensal', l:'Mensal' }, { v:'semanal', l:'Semanal' }, { v:'anual', l:'Anual' }]} />
          <FInput label={form.frequencia === 'semanal' ? 'Dia da semana (1-7)' : 'Dia de execucao'} type="number" value={form.dia_execucao} onChange={value => setForm(current => ({ ...current, dia_execucao:value }))} />
          <FInput label="Data inicio" type="date" value={form.data_inicio} onChange={value => setForm(current => ({ ...current, data_inicio:value }))} />
          <FInput label="Data fim (opcional)" type="date" value={form.data_fim || ''} onChange={value => setForm(current => ({ ...current, data_fim:value }))} />
        </div>

        <div style={{ marginTop:14, display:'flex', flexDirection:'column', gap:8 }}>
          <label style={checkLabelStyle}>
            <input type="checkbox" checked={Boolean(form.auto_mark_as_paid)} onChange={event => setForm(current => ({ ...current, auto_mark_as_paid:event.target.checked }))} />
            Criar automaticamente como pago
          </label>
          <label style={checkLabelStyle}>
            <input type="checkbox" checked={Boolean(form.ativo)} onChange={event => setForm(current => ({ ...current, ativo:event.target.checked }))} />
            Recorrencia ativa
          </label>
        </div>

        <div style={{ marginTop:16, display:'flex', justifyContent:'flex-end', gap:8 }}>
          <Btn variant="ghost" onClick={() => setOpenModal(false)}>Cancelar</Btn>
          <Btn onClick={saveRecurrence} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</Btn>
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(confirmState)}
        onClose={() => setConfirmState(null)}
        onConfirm={() => {
          if (!confirmState) return
          deleteRecurrence(confirmState)
          setConfirmState(null)
        }}
        message="Deseja excluir esta recorrencia?"
      />
    </div>
  )
}

function clampExecutionDay(value, frequency) {
  const n = Math.max(1, Math.floor(Number(value || 1)))
  if (frequency === 'semanal') return Math.min(n, 7)
  return Math.min(n, 31)
}

function getNextExecutionDate(item) {
  const current = new Date()
  const currentDate = toDateString(current)
  if (!item?.ativo || !item?.data_inicio) return null
  if (item.data_fim && item.data_fim < currentDate) return null

  const frequency = item.frequencia || 'mensal'
  const execDay = clampExecutionDay(item.dia_execucao, frequency)

  if (frequency === 'semanal') {
    const currentDow = current.getDay() === 0 ? 7 : current.getDay()
    const diff = execDay >= currentDow ? execDay - currentDow : (7 - currentDow + execDay)
    const next = new Date(current)
    next.setDate(current.getDate() + diff)
    const nextStr = toDateString(next)
    if (nextStr < item.data_inicio) return item.data_inicio
    if (item.data_fim && nextStr > item.data_fim) return null
    return nextStr
  }

  if (frequency === 'anual') {
    const start = new Date(`${item.data_inicio}T00:00:00`)
    const month = start.getMonth()
    let year = current.getFullYear()
    let day = Math.min(execDay, daysInMonth(year, month))
    let next = new Date(year, month, day)
    if (next < startOfToday()) {
      year += 1
      day = Math.min(execDay, daysInMonth(year, month))
      next = new Date(year, month, day)
    }
    const nextStr = toDateString(next)
    if (nextStr < item.data_inicio) return item.data_inicio
    if (item.data_fim && nextStr > item.data_fim) return null
    return nextStr
  }

  const base = new Date(current.getFullYear(), current.getMonth(), 1)
  let day = Math.min(execDay, daysInMonth(base.getFullYear(), base.getMonth()))
  let next = new Date(base.getFullYear(), base.getMonth(), day)
  if (next < startOfToday()) {
    const nextMonth = new Date(base.getFullYear(), base.getMonth() + 1, 1)
    day = Math.min(execDay, daysInMonth(nextMonth.getFullYear(), nextMonth.getMonth()))
    next = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), day)
  }

  const nextStr = toDateString(next)
  if (nextStr < item.data_inicio) return item.data_inicio
  if (item.data_fim && nextStr > item.data_fim) return null
  return nextStr
}

function daysUntil(dateString) {
  const start = startOfToday().getTime()
  const target = new Date(`${dateString}T00:00:00`).getTime()
  return Math.max(0, Math.ceil((target - start) / 86400000))
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

function startOfToday() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function toDateString(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function labelize(value) {
  const text = String(value || '').replaceAll('_', ' ').trim()
  if (!text) return '-'
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const titleStyle = {
  margin:'0',
  fontSize:15,
  color:C.text,
}

const thStyle = {
  textAlign:'left',
  padding:'10px 12px',
  color:C.textSub,
  fontSize:11,
  letterSpacing:'0.08em',
  textTransform:'uppercase',
}

const tdStyle = {
  padding:'10px 12px',
  color:C.text,
  fontSize:13,
  whiteSpace:'nowrap',
}

const checkLabelStyle = {
  display:'inline-flex',
  alignItems:'center',
  gap:8,
  color:C.textSub,
  fontSize:13,
}
