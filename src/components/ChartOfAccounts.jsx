import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { Badge, Btn, Card, ConfirmModal, FInput, Modal } from './UI.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import {
  ACCOUNT_NATURES,
  DRE_SECTIONS,
  accountPath,
  buildAccountTree,
  canMoveAccount,
  descendantIds,
  nextSiblingOrder,
  normalizeChartAccount,
} from '../lib/chartOfAccounts.js'
import {
  countChartAccountUsage,
  createChartAccount,
  deleteChartAccount,
  ensureDefaultChartAccounts,
  fetchChartAccounts,
  isChartSchemaMissing,
  setChartAccountActive,
  updateChartAccount,
  updateChartAccountOrder,
} from '../lib/chartOfAccountsStore.js'

const EMPTY_FORM = {
  code:'', name:'', nodeType:'account', parentId:'', nature:'operating_expense',
  dreSection:'administrative', description:'', isActive:true, sortOrder:0,
}

const NATURE_COLORS = {
  asset:C.cyan, liability:C.yellow, equity:C.purple, revenue:C.green,
  financial_revenue:C.green, revenue_deduction:C.yellow, direct_cost:C.red,
  operating_expense:C.red, depreciation:C.purple, financial_expense:C.red,
  income_tax:C.yellow, unclassified:C.textDim,
}

export function ChartOfAccounts({ data, setData }) {
  const { ownerId, role } = useUserRole()
  const { toast } = useToast()
  const [accounts, setAccounts] = useState(() => (data?.chartAccounts || []).map(normalizeChartAccount))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [schemaMissing, setSchemaMissing] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [expanded, setExpanded] = useState(() => new Set())
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [confirm, setConfirm] = useState(null)
  const [draggedId, setDraggedId] = useState('')
  const canEdit = role === 'admin' || role === 'gestao'

  const tree = useMemo(() => buildAccountTree(accounts), [accounts])
  const byId = useMemo(() => new Map(accounts.map(item => [item.id, item])), [accounts])
  const selected = byId.get(selectedId) || null
  const groups = useMemo(() => accounts.filter(item => item.nodeType === 'group').sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric:true })), [accounts])

  useEffect(() => {
    let active = true
    async function load() {
      if (!ownerId) return
      setLoading(true)
      setSchemaMissing(false)
      try {
        const next = await ensureDefaultChartAccounts(ownerId)
        if (!active) return
        syncAccounts(next)
        const rootIds = next.filter(item => !item.parentId).map(item => item.id)
        setExpanded(new Set(rootIds))
        setSelectedId(current => current || next[0]?.id || '')
      } catch (error) {
        if (!active) return
        if (isChartSchemaMissing(error)) setSchemaMissing(true)
        else toast(error.message || 'Não foi possível carregar o plano de contas.', 'warning')
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId])

  function syncAccounts(next) {
    const normalized = (next || []).map(normalizeChartAccount)
    setAccounts(normalized)
    setData?.(current => ({ ...current, chartAccounts:normalized }))
  }

  async function reload() {
    const next = await fetchChartAccounts(ownerId)
    syncAccounts(next)
    return next
  }

  function openCreate(nodeType, parent) {
    const inherited = parent === undefined
      ? (selected?.nodeType === 'group' ? selected : null)
      : parent
    setForm({
      ...EMPTY_FORM,
      nodeType,
      parentId:inherited?.id || '',
      nature:inherited?.nature || (nodeType === 'account' ? 'operating_expense' : 'unclassified'),
      dreSection:inherited?.dreSection || (nodeType === 'account' ? 'administrative' : 'unclassified'),
      sortOrder:nextSiblingOrder(accounts, inherited?.id || null),
    })
    setModal('create')
  }

  function openEdit(item) {
    setForm({ ...normalizeChartAccount(item), parentId:item.parentId || '' })
    setModal('edit')
  }

  function applyParent(parentId) {
    const parent = byId.get(parentId)
    setForm(current => ({
      ...current,
      parentId,
      ...(parent ? { ...(parent.nature !== 'unclassified' ? { nature:parent.nature } : {}), dreSection:parent.dreSection } : {}),
    }))
  }

  async function save() {
    if (!form.code.trim() || !form.name.trim()) {
      toast('Informe código e nome.', 'warning')
      return
    }
    if (modal === 'edit' && !canMoveAccount(accounts, form.id, form.parentId || null)) {
      toast('Esse movimento criaria um ciclo na árvore.', 'warning')
      return
    }
    if (modal === 'edit' && form.nodeType === 'account' && accounts.some(item => item.parentId === form.id)) {
      toast('Um grupo com itens abaixo não pode virar categoria. Mova os itens primeiro.', 'warning')
      return
    }
    setSaving(true)
    try {
      const saved = modal === 'edit'
        ? await updateChartAccount(ownerId, form.id, form)
        : await createChartAccount(ownerId, form)
      await reload()
      setSelectedId(saved.id)
      if (saved.parentId) setExpanded(current => new Set([...current, saved.parentId]))
      setModal(null)
      toast(modal === 'edit' ? 'Conta atualizada.' : `${form.nodeType === 'group' ? 'Grupo' : 'Categoria'} criado.`)
    } catch (error) {
      const duplicate = String(error?.code || '') === '23505'
      toast(duplicate ? 'Já existe uma conta com esse código.' : (error.message || 'Não foi possível salvar.'), 'warning')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(item) {
    if (item.systemKey && item.isActive) {
      toast('Contas automáticas não podem ser desativadas.', 'warning')
      return
    }
    try {
      await setChartAccountActive(ownerId, item.id, !item.isActive)
      await reload()
      toast(item.isActive ? 'Conta desativada; o histórico foi preservado.' : 'Conta reativada.')
    } catch (error) {
      toast(error.message || 'Não foi possível alterar a situação.', 'warning')
    }
  }

  async function requestDelete(item) {
    const children = accounts.filter(account => account.parentId === item.id)
    if (children.length) {
      toast('Mova ou remova as contas filhas antes de excluir este grupo.', 'warning')
      return
    }
    if (item.systemKey) {
      toast('Esta conta alimenta lançamentos automáticos e não pode ser excluída.', 'warning')
      return
    }
    try {
      const usage = await countChartAccountUsage(ownerId, item.id)
      setConfirm({ item, usage })
    } catch (error) {
      toast(error.message || 'Não foi possível verificar o uso da conta.', 'warning')
    }
  }

  async function confirmDelete() {
    if (!confirm?.item) return
    const { item, usage } = confirm
    try {
      if (usage > 0) {
        await setChartAccountActive(ownerId, item.id, false)
        toast(`Conta desativada. ${usage} lançamento(s) histórico(s) foram preservados.`)
      } else {
        await deleteChartAccount(ownerId, item.id)
        toast('Conta removida.')
      }
      const next = await reload()
      setSelectedId(next.find(account => account.id !== item.id)?.id || '')
    } catch (error) {
      toast(error.message || 'Não foi possível remover a conta.', 'warning')
    }
  }

  async function moveSibling(item, delta) {
    const siblings = accounts
      .filter(candidate => (candidate.parentId || null) === (item.parentId || null))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    const index = siblings.findIndex(candidate => candidate.id === item.id)
    const target = siblings[index + delta]
    if (!target) return
    try {
      await updateChartAccountOrder(ownerId, [
        { ...item, sortOrder:target.sortOrder },
        { ...target, sortOrder:item.sortOrder },
      ])
      await reload()
    } catch (error) {
      toast(error.message || 'Não foi possível reordenar.', 'warning')
    }
  }

  async function dropOn(target) {
    const dragged = byId.get(draggedId)
    setDraggedId('')
    if (!dragged || target.nodeType !== 'group' || !canMoveAccount(accounts, dragged.id, target.id)) return
    if (dragged.parentId === target.id) return
    try {
      await updateChartAccount(ownerId, dragged.id, {
        ...dragged,
        parentId:target.id,
        nature:target.nature === 'unclassified' ? dragged.nature : target.nature,
        dreSection:target.dreSection,
        sortOrder:nextSiblingOrder(accounts, target.id),
      })
      await reload()
      setExpanded(current => new Set([...current, target.id]))
      toast(`“${dragged.name}” movida para “${target.name}”.`)
    } catch (error) {
      toast(error.message || 'Não foi possível mover a conta.', 'warning')
    }
  }

  const visibleIds = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return null
    const ids = new Set()
    accounts.forEach(item => {
      if (`${item.code} ${item.name} ${item.description}`.toLowerCase().includes(term)) {
        ids.add(item.id)
        accountPath(accounts, item.id).forEach(parent => ids.add(parent.id))
        descendantIds(accounts, item.id).forEach(id => ids.add(id))
      }
    })
    return ids
  }, [accounts, query])

  const summary = useMemo(() => ({
    groups:accounts.filter(item => item.nodeType === 'group').length,
    accounts:accounts.filter(item => item.nodeType === 'account').length,
    inactive:accounts.filter(item => !item.isActive).length,
    automatic:accounts.filter(item => item.systemKey).length,
  }), [accounts])

  if (schemaMissing) {
    return <Card style={{ border:`1px solid ${C.yellow}55` }}>
      <div style={{ color:C.yellow, fontWeight:800, marginBottom:8 }}>Migração do plano de contas pendente</div>
      <div style={{ color:C.textSub, lineHeight:1.6, fontSize:13 }}>
        Aplique <code>supabase/chart_of_accounts_schema.sql</code> antes de usar esta área. Nenhum lançamento existente foi alterado.
      </div>
    </Card>
  }

  if (loading) return <Card><div style={{ color:C.textDim }}>Preparando o plano padrão da clínica…</div></Card>

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10 }}>
        <Summary label="Grupos" value={summary.groups} color={C.accent} />
        <Summary label="Categorias" value={summary.accounts} color={C.green} />
        <Summary label="Contas automáticas" value={summary.automatic} color={C.purple} />
        <Summary label="Inativas" value={summary.inactive} color={C.textDim} />
      </div>

      <Card style={{ padding:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
          <div style={{ minWidth:240, flex:'1 1 320px' }}>
            <FInput value={query} onChange={setQuery} placeholder="Buscar código, grupo ou categoria…" />
          </div>
          {canEdit && <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <Btn variant="ghost" onClick={() => openCreate('group', null)}>+ Novo grupo</Btn>
            <Btn onClick={() => openCreate('account')}>+ Nova categoria</Btn>
          </div>}
        </div>
        <div style={{ marginTop:10, fontSize:12, color:C.textDim }}>
          Arraste uma conta sobre um grupo para movê-la. Os lançamentos continuam ligados pelo identificador interno.
        </div>
      </Card>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,360px),1fr))', gap:16, alignItems:'start' }}>
        <Card style={{ padding:10, minHeight:520, overflow:'hidden' }}>
          <div style={{ maxHeight:'68vh', overflowY:'auto', padding:4 }}>
            {tree.map(node => <TreeNode key={node.id} node={node} depth={0} expanded={expanded} setExpanded={setExpanded}
              selectedId={selectedId} setSelectedId={setSelectedId} visibleIds={visibleIds}
              onDragStart={setDraggedId} onDrop={dropOn} />)}
          </div>
        </Card>

        <Card style={{ padding:20, position:'sticky', top:12 }}>
          {!selected ? <div style={{ color:C.textDim }}>Selecione um item da árvore.</div> : <>
            <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'flex-start' }}>
              <div>
                <div style={{ color:C.textDim, fontSize:11, textTransform:'uppercase', letterSpacing:'0.08em' }}>{selected.code}</div>
                <div style={{ color:C.text, fontWeight:850, fontSize:20, marginTop:4 }}>{selected.name}</div>
              </div>
              <Badge color={selected.isActive ? C.green : C.textDim} small>{selected.isActive ? 'ativa' : 'inativa'}</Badge>
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:12 }}>
              <Badge color={NATURE_COLORS[selected.nature] || C.textDim} small>{natureLabel(selected.nature)}</Badge>
              <Badge color={selected.nodeType === 'group' ? C.accent : C.green} small>{selected.nodeType === 'group' ? 'grupo' : 'categoria'}</Badge>
              {selected.systemKey && <Badge color={C.purple} small>automática</Badge>}
            </div>
            <div style={{ marginTop:16, fontSize:12, color:C.textDim, lineHeight:1.6 }}>
              <strong style={{ color:C.textSub }}>Caminho</strong><br />
              {accountPath(accounts, selected.id).map(item => item.name).join(' › ')}
            </div>
            <div style={{ marginTop:12, fontSize:12, color:C.textDim, lineHeight:1.6 }}>
              <strong style={{ color:C.textSub }}>DRE / relatório</strong><br />
              {dreLabel(selected.dreSection)}
            </div>
            {selected.description && <div style={{ marginTop:12, color:C.textSub, fontSize:13, lineHeight:1.6 }}>{selected.description}</div>}
            {selected.systemKey && <div style={{ marginTop:14, padding:10, borderRadius:10, background:C.purple+'12', border:`1px solid ${C.purple}33`, color:C.textSub, fontSize:12, lineHeight:1.55 }}>
              Esta conta recebe lançamentos automáticos do sistema. Pode ser renomeada e movida, mas não excluída enquanto estiver vinculada.
            </div>}
            {canEdit && <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginTop:18 }}>
              <Btn onClick={() => openEdit(selected)} style={{ padding:'7px 12px' }}>Editar</Btn>
              <Btn variant="ghost" onClick={() => openCreate(selected.nodeType === 'group' ? 'account' : 'account', selected.nodeType === 'group' ? selected : byId.get(selected.parentId))} style={{ padding:'7px 12px' }}>Adicionar abaixo</Btn>
              <Btn variant="ghost" onClick={() => moveSibling(selected, -1)} style={{ padding:'7px 10px' }}>↑</Btn>
              <Btn variant="ghost" onClick={() => moveSibling(selected, 1)} style={{ padding:'7px 10px' }}>↓</Btn>
              <Btn variant={selected.isActive ? 'warn' : 'success'} onClick={() => toggleActive(selected)} style={{ padding:'7px 12px' }}>{selected.isActive ? 'Desativar' : 'Ativar'}</Btn>
              <Btn variant="danger" onClick={() => requestDelete(selected)} style={{ padding:'7px 12px' }}>Remover</Btn>
            </div>}
          </>}
        </Card>
      </div>

      <Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal === 'edit' ? 'Editar item do plano' : (form.nodeType === 'group' ? 'Novo grupo' : 'Nova categoria')} width={640}>
        <div style={{ display:'grid', gridTemplateColumns:'140px minmax(0,1fr)', gap:12 }}>
          <FInput label="Código" required value={form.code} onChange={value => setForm(current => ({ ...current, code:value }))} placeholder="7.04.09" />
          <FInput label="Nome" required value={form.name} onChange={value => setForm(current => ({ ...current, name:value }))} placeholder="Nome da categoria" />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12, marginTop:12 }}>
          <FInput label="Tipo" value={form.nodeType} onChange={value => setForm(current => ({ ...current, nodeType:value }))} options={[{ v:'group', l:'Grupo (não recebe lançamentos)' }, { v:'account', l:'Categoria lançável' }]} />
          <FInput label="Grupo superior" value={form.parentId || ''} onChange={applyParent} options={[
            { v:'', l:'Raiz do plano' },
            ...groups.filter(group => group.id !== form.id && !descendantIds(accounts, form.id).includes(group.id)).map(group => ({ v:group.id, l:`${group.code} · ${group.name}` })),
          ]} />
          <FInput label="Natureza" value={form.nature} onChange={value => setForm(current => ({ ...current, nature:value }))} options={ACCOUNT_NATURES.map(item => ({ v:item.value, l:item.label }))} />
          <FInput label="Seção da DRE/relatório" value={form.dreSection} onChange={value => setForm(current => ({ ...current, dreSection:value }))} options={DRE_SECTIONS.map(item => ({ v:item.value, l:item.label }))} />
        </div>
        <div style={{ marginTop:12 }}>
          <FInput label="Descrição e regra de uso" value={form.description || ''} onChange={value => setForm(current => ({ ...current, description:value }))} placeholder="Quando esta categoria deve ser utilizada?" />
        </div>
        <label style={{ marginTop:14, display:'flex', alignItems:'center', gap:8, color:C.textSub, fontSize:13 }}>
          <input type="checkbox" checked={form.isActive !== false} onChange={event => setForm(current => ({ ...current, isActive:event.target.checked }))} />
          Disponível para novos lançamentos
        </label>
        <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:20 }}>
          <Btn variant="ghost" onClick={() => setModal(null)}>Cancelar</Btn>
          <Btn onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Btn>
        </div>
      </Modal>

      <ConfirmModal open={Boolean(confirm)} onClose={() => setConfirm(null)} onConfirm={confirmDelete}
        title={confirm?.usage > 0 ? 'Desativar categoria' : 'Remover categoria'}
        confirmLabel={confirm?.usage > 0 ? 'Desativar' : 'Remover'}
        confirmVariant={confirm?.usage > 0 ? 'warn' : 'danger'}
        message={confirm?.usage > 0
          ? `“${confirm.item.name}” possui ${confirm.usage} vínculo(s). Ela será desativada e todo o histórico permanecerá intacto.`
          : `Remover “${confirm?.item?.name || ''}”? Ela não possui lançamentos vinculados.`} />
    </div>
  )
}

function TreeNode({ node, depth, expanded, setExpanded, selectedId, setSelectedId, visibleIds, onDragStart, onDrop }) {
  if (visibleIds && !visibleIds.has(node.id)) return null
  const hasChildren = node.children.length > 0
  const isExpanded = expanded.has(node.id) || Boolean(visibleIds)
  const selected = selectedId === node.id
  return <div>
    <div
      draggable
      onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; onDragStart(node.id) }}
      onDragOver={event => { if (node.nodeType === 'group') event.preventDefault() }}
      onDrop={event => { event.preventDefault(); onDrop(node) }}
      onClick={() => setSelectedId(node.id)}
      style={{ display:'grid', gridTemplateColumns:'22px minmax(0,1fr) auto', alignItems:'center', gap:7, padding:'8px 10px', paddingLeft:10 + depth * 18, borderRadius:10, cursor:'pointer', background:selected ? C.accent+'18' : 'transparent', border:selected ? `1px solid ${C.accent}44` : '1px solid transparent', opacity:node.isActive ? 1 : 0.48, marginBottom:2 }}
    >
      <button onClick={event => { event.stopPropagation(); if (!hasChildren) return; setExpanded(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next }) }} style={{ border:'none', background:'transparent', color:C.textDim, cursor:hasChildren ? 'pointer' : 'default', padding:0, fontSize:12 }}>
        {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
      </button>
      <div style={{ minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:7, minWidth:0 }}>
          <span style={{ color:C.textDim, fontSize:11, flexShrink:0 }}>{node.code}</span>
          <span style={{ color:C.text, fontSize:13, fontWeight:node.nodeType === 'group' ? 750 : 550, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{node.name}</span>
        </div>
      </div>
      <div style={{ display:'flex', gap:5, alignItems:'center' }}>
        {node.systemKey && <span title="Conta automática" style={{ color:C.purple, fontSize:11 }}>◆</span>}
        <span style={{ width:7, height:7, borderRadius:99, background:NATURE_COLORS[node.nature] || C.textDim }} />
      </div>
    </div>
    {hasChildren && isExpanded && <div>{node.children.map(child => <TreeNode key={child.id} node={child} depth={depth + 1} expanded={expanded} setExpanded={setExpanded} selectedId={selectedId} setSelectedId={setSelectedId} visibleIds={visibleIds} onDragStart={onDragStart} onDrop={onDrop} />)}</div>}
  </div>
}

function Summary({ label, value, color }) {
  return <Card style={{ padding:15 }}><div style={{ color:C.textDim, fontSize:11, textTransform:'uppercase', letterSpacing:'0.07em' }}>{label}</div><div style={{ color, fontSize:24, fontWeight:900, marginTop:5 }}>{value}</div></Card>
}

function natureLabel(value) {
  return ACCOUNT_NATURES.find(item => item.value === value)?.label || value
}

function dreLabel(value) {
  return DRE_SECTIONS.find(item => item.value === value)?.label || value
}
