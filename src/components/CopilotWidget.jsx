import { useEffect, useMemo, useRef, useState } from 'react'
import { C, base } from '../theme.js'
import { buildFinancialBrain } from '../ai/financialBrain.js'
import {
  createFinancialConversation,
  deleteFinancialConversation,
  getFinancialConversationMessages,
  getFinancialConversations,
  queryFinancialAssistant,
  saveFinancialMessageFeedback,
  updateFinancialConversation,
} from '../lib/aiClient.js'

const QUICK_QUESTIONS = ['Qual foi meu lucro este mês?', 'Qual procedimento é mais lucrativo?', 'O que preciso fazer esta semana?']
const INITIAL_MESSAGE = { role:'assistant', content:'Sou o copiloto do SurgiMetrics. Posso responder sobre lucro, caixa, metas, riscos e previsões.', meta:{ source:'local', mode:'welcome', reason:'', evidence:[] } }

export function CopilotWidget({ data }) {
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 1024 : false
  const brain = useMemo(() => buildFinancialBrain(data), [data])
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState('')
  const [conversationMenuId, setConversationMenuId] = useState('')
  const [renamingId, setRenamingId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState([INITIAL_MESSAGE])
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const [feedbackBusyId, setFeedbackBusyId] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, open, sending])

  const loadConversations = async () => {
    if (loaded || loadingConversations) return
    setLoadingConversations(true)
    try { const result = await getFinancialConversations(); setConversations(sortConversations(result.conversations || [])) }
    catch { /* mantém o modo limitado */ }
    finally { setLoaded(true); setLoadingConversations(false) }
  }

  const openCopilot = () => { setOpen(current => !current); if (!open) loadConversations() }

  const selectConversation = async conversation => {
    if (!conversation?.id || conversation.id === activeConversationId || sending) return
    setConversationMenuId(''); setActiveConversationId(conversation.id); setMessages([INITIAL_MESSAGE])
    try {
      const result = await getFinancialConversationMessages(conversation.id)
      const restored = (result.messages || []).map(message => ({
        id:message.id,
        role:message.role,
        content:message.content,
        meta:message.role === 'assistant' ? { source:message.source, mode:message.mode, reason:message.reason, evidence:message.evidence || [], requestId:message.request_id, messageId:message.id, feedback:message.feedback ?? null } : undefined,
      }))
      setMessages([INITIAL_MESSAGE, ...restored])
    } catch { /* a saudação permite continuar mesmo se a memória estiver indisponível */ }
  }

  const newConversation = async () => {
    if (sending) return
    try {
      const result = await createFinancialConversation()
      const conversation = result.conversation
      setConversations(current => sortConversations([conversation, ...current.filter(item => item.id !== conversation.id)]))
      setConversationMenuId(''); setActiveConversationId(conversation.id); setMessages([INITIAL_MESSAGE])
    } catch { setActiveConversationId(''); setMessages([INITIAL_MESSAGE]) }
  }

  const renameConversation = async conversation => {
    const title = renameValue.trim()
    if (!title || !conversation?.id) return
    try {
      const result = await updateFinancialConversation('rename-conversation', { conversationId:conversation.id, title })
      replaceConversation(result.conversation)
      setRenamingId(''); setConversationMenuId('')
    } catch { /* mantém o nome anterior e deixa o usuário tentar novamente */ }
  }

  const togglePin = async conversation => {
    try {
      const result = await updateFinancialConversation('pin-conversation', { conversationId:conversation.id, isPinned:!conversation.is_pinned })
      replaceConversation(result.conversation); setConversationMenuId('')
    } catch { /* mantém o estado anterior */ }
  }

  const removeConversation = async conversation => {
    if (!conversation?.id || !window.confirm(`Excluir a conversa “${conversation.title || 'Nova conversa'}”?`)) return
    try {
      await deleteFinancialConversation(conversation.id)
      const remaining = conversations.filter(item => item.id !== conversation.id)
      setConversations(sortConversations(remaining)); setConversationMenuId('')
      if (conversation.id === activeConversationId) {
        setActiveConversationId(''); setMessages([INITIAL_MESSAGE])
        if (remaining[0]) selectConversation(remaining[0])
      }
    } catch { /* a conversa permanece visível se a exclusão falhar */ }
  }

  const replaceConversation = conversation => setConversations(current => sortConversations(current.map(item => item.id === conversation.id ? { ...item, ...conversation } : item)))

  const send = async presetQuestion => {
    const question = (presetQuestion || input).trim()
    if (!question || sending) return
    let conversationId = activeConversationId
    if (!conversationId) {
      try {
        const created = await createFinancialConversation(); conversationId = created.conversation.id
        setActiveConversationId(conversationId); setConversations(current => sortConversations([created.conversation, ...current]))
      } catch { /* uma resposta local ainda pode ser exibida */ }
    }
    const history = messages
    setMessages(current => [...current, { role:'user', content:question }]); setInput(''); setSending(true)
    try {
      const result = await queryFinancialAssistant({ question, brain, history, conversationId })
      setMessages(current => [...current, { role:'assistant', content:result.answer, meta:{ source:result.source, mode:result.mode, reason:result.reason, evidence:result.evidence, requestId:result.requestId, question, messageId:result.assistantMessageId, feedback:null } }])
      if (result.conversation) replaceConversation(result.conversation)
    } finally { setSending(false) }
  }

  const copyMessage = async message => {
    try { await navigator.clipboard.writeText(message.content); setCopiedMessageId(message.id || message.meta?.messageId || message.content); setTimeout(() => setCopiedMessageId(''), 1800) } catch { /* clipboard bloqueado pelo navegador */ }
  }

  const shareMessage = async message => {
    const title = 'Resposta do copiloto financeiro'
    if (navigator.share) {
      try { await navigator.share({ title, text:message.content }); return } catch { return }
    }
    copyMessage(message)
  }

  const giveFeedback = async (message, feedback) => {
    const messageId = message.id || message.meta?.messageId
    if (!messageId || feedbackBusyId) return
    const previous = message.meta?.feedback ?? null
    const next = previous === feedback ? null : feedback
    const sameMessage = item => (item.id || item.meta?.messageId) === messageId
    setMessages(current => current.map(item => sameMessage(item) ? { ...item, meta:{ ...item.meta, feedback:next } } : item))
    setFeedbackBusyId(messageId)
    try { await saveFinancialMessageFeedback(messageId, next) }
    catch { setMessages(current => current.map(item => sameMessage(item) ? { ...item, meta:{ ...item.meta, feedback:previous } } : item)) }
    finally { setFeedbackBusyId('') }
  }

  const pinned = conversations.filter(item => item.is_pinned)
  const recent = conversations.filter(item => !item.is_pinned)

  return <>
    <button type="button" onClick={openCopilot} style={{ position:'fixed', right:24, bottom:isMobile ? 'calc(74px + env(safe-area-inset-bottom))' : 24, width:62, height:62, borderRadius:20, border:`1px solid ${C.borderBright}`, background:C.surface, display:'grid', placeItems:'center', padding:6, cursor:'pointer', boxShadow:'0 18px 45px rgba(15, 23, 42, 0.35)', zIndex:60 }} title={open ? 'Fechar copiloto' : 'Abrir copiloto'}><img src="/assets/coruja-analitica.png" alt="Coruja analítica SurgiMetrics" style={{ width:'100%', height:'100%', objectFit:'cover', borderRadius:14 }} /></button>
    {open && <div style={{ position:'fixed', right:24, bottom:isMobile ? 'calc(148px + env(safe-area-inset-bottom))' : 98, width:'min(820px, calc(100vw - 32px))', height:isMobile ? 'min(700px, calc(100vh - 220px))' : 'min(700px, calc(100vh - 140px))', borderRadius:24, border:`1px solid ${C.borderBright}`, background:C.card, boxShadow:'0 26px 80px rgba(15, 23, 42, 0.45)', zIndex:60, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <header style={{ padding:'16px 18px', borderBottom:`1px solid ${C.border}`, background:`radial-gradient(circle at top right, ${C.cyan}22, transparent 40%), linear-gradient(180deg, ${C.surface}, ${C.card})` }}><div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}><div style={{ display:'flex', alignItems:'center', gap:10 }}><AssistantPortrait /><div><div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em' }}>Copiloto financeiro</div><div style={{ color:C.text, fontWeight:800, marginTop:3 }}>Coruja analítica do SurgiMetrics</div></div></div><button type="button" onClick={() => setOpen(false)} style={iconButtonStyle}>×</button></div></header>
      <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '250px 1fr', minHeight:0, flex:1 }}>
        <aside style={{ borderRight:isMobile ? 'none' : `1px solid ${C.border}`, borderBottom:isMobile ? `1px solid ${C.border}` : 'none', padding:12, overflowY:'auto', maxHeight:isMobile ? 190 : 'none', background:C.card }}>
          <button type="button" onClick={newConversation} style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:`1px solid ${C.accent}66`, background:`${C.accent}18`, color:C.text, cursor:'pointer', fontWeight:700, fontSize:12, textAlign:'left' }}>＋ Nova conversa</button>
          <div style={sectionLabel}>Fixadas</div>
          {pinned.map(item => <ConversationRow key={item.id} conversation={item} active={item.id === activeConversationId} menuOpen={conversationMenuId === item.id} renaming={renamingId === item.id} renameValue={renameValue} onSelect={selectConversation} onMenu={() => setConversationMenuId(conversationMenuId === item.id ? '' : item.id)} onRenameStart={() => { setRenamingId(item.id); setRenameValue(item.title || '') }} onRenameChange={setRenameValue} onRename={() => renameConversation(item)} onPin={() => togglePin(item)} onDelete={() => removeConversation(item)} />)}
          {pinned.length === 0 && <div style={emptySection}>Nenhuma conversa fixada.</div>}
          <div style={sectionLabel}>Recentes</div>
          {recent.map(item => <ConversationRow key={item.id} conversation={item} active={item.id === activeConversationId} menuOpen={conversationMenuId === item.id} renaming={renamingId === item.id} renameValue={renameValue} onSelect={selectConversation} onMenu={() => setConversationMenuId(conversationMenuId === item.id ? '' : item.id)} onRenameStart={() => { setRenamingId(item.id); setRenameValue(item.title || '') }} onRenameChange={setRenameValue} onRename={() => renameConversation(item)} onPin={() => togglePin(item)} onDelete={() => removeConversation(item)} />)}
          {!conversations.length && <div style={emptySection}>{loadingConversations ? 'Carregando conversas...' : 'Suas conversas aparecerão aqui.'}</div>}
        </aside>
        <section style={{ minWidth:0, display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'10px 12px', display:'flex', gap:7, flexWrap:'wrap', borderBottom:`1px solid ${C.border}` }}>{QUICK_QUESTIONS.map(item => <button key={item} type="button" onClick={() => send(item)} style={{ padding:'6px 9px', borderRadius:999, border:`1px solid ${C.border}`, background:C.surface, color:C.textSub, fontSize:11, cursor:'pointer' }}>{item}</button>)}</div>
          <div style={{ flex:1, overflowY:'auto', padding:18, display:'flex', flexDirection:'column', gap:14 }}>{messages.map((message, index) => <MessageBubble key={`${message.id || message.role}-${index}`} message={message} copied={copiedMessageId === (message.id || message.meta?.messageId || message.content)} onCopy={() => copyMessage(message)} onShare={() => shareMessage(message)} onFeedback={feedback => giveFeedback(message, feedback)} />)}{sending && <div style={assistantBubbleStyle}>Analisando os dados...</div>}<div ref={bottomRef} /></div>
          <div style={{ padding:14, borderTop:`1px solid ${C.border}`, display:'flex', gap:10 }}><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} rows={2} placeholder="Pergunte ao copiloto" style={{ ...base.input, flex:1, resize:'none', padding:'10px 12px', fontSize:13, lineHeight:1.5 }} /><button type="button" onClick={() => send()} disabled={!input.trim() || sending} style={{ minWidth:78, borderRadius:12, border:'none', background:C.accent, color:'#fff', cursor:sending ? 'not-allowed' : 'pointer', opacity:sending ? 0.6 : 1, fontWeight:700 }}>Enviar</button></div>
        </section>
      </div>
    </div>}
  </>
}

function ConversationRow({ conversation, active, menuOpen, renaming, renameValue, onSelect, onMenu, onRenameStart, onRenameChange, onRename, onPin, onDelete }) {
  return <div style={{ position:'relative', display:'flex', alignItems:'center', gap:4, marginBottom:4 }}><button type="button" onClick={() => onSelect(conversation)} style={{ flex:1, minWidth:0, textAlign:'left', padding:'10px 9px', borderRadius:9, border:'none', background:active ? `${C.accent}22` : 'transparent', color:active ? C.text : C.textSub, cursor:'pointer', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12 }}>{renaming ? <input autoFocus value={renameValue} onChange={e => onRenameChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onRename(); if (e.key === 'Escape') onRenameChange(conversation.title || '') }} onClick={e => e.stopPropagation()} style={{ ...base.input, width:'100%', padding:'3px 5px', fontSize:11 }} /> : conversation.title || 'Nova conversa'}</button><button type="button" onClick={onMenu} style={{ ...iconButtonStyle, width:28, height:28, fontSize:16 }} aria-label={`Ações da conversa ${conversation.title || ''}`}>•••</button>{menuOpen && <div style={{ position:'absolute', zIndex:3, right:0, top:34, width:150, padding:5, borderRadius:10, border:`1px solid ${C.borderBright}`, background:C.card, boxShadow:'0 12px 30px rgba(0,0,0,.25)' }}><MenuAction label="Renomear" onClick={onRenameStart} /><MenuAction label={conversation.is_pinned ? 'Desafixar' : 'Fixar'} onClick={onPin} /><MenuAction label="Excluir" danger onClick={onDelete} /></div>}</div>
}

function MenuAction({ label, onClick, danger = false }) { return <button type="button" onClick={onClick} style={{ width:'100%', border:'none', background:'transparent', color:danger ? C.red : C.text, textAlign:'left', borderRadius:7, padding:'8px 9px', cursor:'pointer', fontSize:12 }}>{label}</button> }

function MessageBubble({ message, copied, onCopy, onShare, onFeedback }) {
  const isUser = message.role === 'user'
  if (isUser) return <div style={{ alignSelf:'flex-end', maxWidth:'88%' }}><div style={userBubbleStyle}>{message.content}</div></div>
  return <div style={{ alignSelf:'flex-start', maxWidth:'92%' }}><div style={assistantBubbleStyle}>{message.content}</div>{message.meta?.mode !== 'welcome' && <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:5, padding:'0 4px', color:C.textDim, fontSize:11 }}><button type="button" onClick={onCopy} style={toolButtonStyle}>{copied ? 'Copiado' : 'Copiar'}</button><button type="button" onClick={onShare} style={toolButtonStyle}>Compartilhar</button><button type="button" onClick={() => onFeedback(1)} style={{ ...toolButtonStyle, color:message.meta?.feedback === 1 ? C.accentLight : C.textDim }} aria-label="Resposta útil">👍</button><button type="button" onClick={() => onFeedback(-1)} style={{ ...toolButtonStyle, color:message.meta?.feedback === -1 ? C.red : C.textDim }} aria-label="Resposta não útil">👎</button><ResponseMeta meta={message.meta} /></div>}</div>
}

function ResponseMeta({ meta }) { const limited = meta?.mode === 'limited' || meta?.source === 'fallback'; const period = meta?.evidence?.map(item => item.period).filter(Boolean)[0] || ''; return <span style={{ marginLeft:4, color:limited ? C.yellow : C.textDim }}>{limited ? 'Modo limitado' : meta?.mode === 'tool_assisted' ? 'Dados consultados' : 'Resposta da IA'}{period ? ` · ${period.replace('/', ' a ')}` : ''}{limited && meta?.reason ? ` · ${meta.reason}` : ''}</span> }
function AssistantPortrait() { return <div style={{ width:42, height:42, borderRadius:13, overflow:'hidden', border:`1px solid ${C.borderBright}`, background:C.surface }}><img src="/assets/coruja-analitica.png" alt="Coruja analítica SurgiMetrics" style={{ width:'100%', height:'100%', objectFit:'cover' }} /></div> }
function sortConversations(items) { return [...items].sort((a, b) => Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) || new Date(b.updated_at || 0) - new Date(a.updated_at || 0)) }

const iconButtonStyle = { width:34, height:34, borderRadius:9, border:`1px solid ${C.border}`, background:'transparent', color:C.textSub, cursor:'pointer', fontSize:18, lineHeight:1 }
const sectionLabel = { color:C.textDim, fontSize:10, margin:'18px 6px 7px', textTransform:'uppercase', letterSpacing:'0.08em' }
const emptySection = { color:C.textDim, fontSize:11, lineHeight:1.5, padding:'0 6px' }
const userBubbleStyle = { padding:'12px 14px', borderRadius:'16px 16px 4px 16px', background:C.accent, border:`1px solid ${C.accent}55`, color:C.text, whiteSpace:'pre-wrap', fontSize:13, lineHeight:1.6 }
const assistantBubbleStyle = { padding:'12px 14px', borderRadius:'16px 16px 16px 4px', background:C.surface, border:`1px solid ${C.border}`, color:C.text, whiteSpace:'pre-wrap', fontSize:13, lineHeight:1.6 }
const toolButtonStyle = { border:'none', background:'transparent', color:C.textDim, padding:'2px 4px', cursor:'pointer', fontSize:11 }
