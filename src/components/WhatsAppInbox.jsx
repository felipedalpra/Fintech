import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { SuggestionBox } from './OpportunityPipeline.jsx'
import { confirmSuggestion, dismissSuggestion } from '../lib/opportunitySuggestion.js'
import { uploadWhatsAppMedia, mediaTypeFromMime } from '../lib/whatsappUpload.js'
import { conversationKind, CONVERSATION_KIND_LABEL } from '../lib/crmContact.js'
import { convertContactToPatient, createWhatsAppContactLead, setContactIgnored } from '../lib/crmContactActions.js'
import { Modal, Btn, FInput } from './UI.jsx'
import { PatientSelector } from './PatientSelector.jsx'
import { Person360Drawer } from './Person360Drawer.jsx'
import { WhatsAppMedia } from './WhatsAppMedia.jsx'
import { applyConversationFilters, createSavedReply, loadConversationStates, loadSavedReplies, operationalConversationKey, saveConversationState, unreadCountForConversation } from '../lib/operationalWorkspace.js'
import './WhatsAppInbox.css'

const EMOJI_GROUPS = [
  { id:'recent', label:'Mais usados', icon:'🕘', items:['😊','😂','❤️','👍','🙏','🎉','😍','🥰','😉','😁','🤗','👏','💚','✅','👋','🙌','🌟','🔥','💪','💜'] },
  { id:'faces', label:'Carinhas', icon:'😊', items:['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤔','🤐','🤨','😐','😑','😶','😏','😒','😴','🤒','🤕','🤢','🤧','🥵','🥶','🥴','😵','🤯','🤠','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😲','😳','🥺','😥','😢','😭','😱'] },
  { id:'gestures', label:'Gestos', icon:'👍', items:['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','💪','👂','👃','🧠','🫀','🫁','🦷','👀'] },
  { id:'hearts', label:'Afeto', icon:'❤️', items:['❤️','🧡','💛','💚','💙','💜','🤎','🖤','🤍','💔','❤️‍🔥','❣️','💕','💞','💓','💗','💖','💘','💝','💟','💌','💋','🌹','🌻','🌷','🌺','🌸','🌼','💐','🌟','✨'] },
  { id:'life', label:'Objetos e saúde', icon:'🩺', items:['📅','📆','⏰','⌚','📱','💻','⌨️','📞','📧','📌','📍','📊','📈','📉','💰','💳','🧾','💊','💉','🩸','🩹','🩺','🩻','🫁','🧪','🧬','🔬','🧴','🧼','🏥','🏠','🚗','🚕','✈️','✅','⚠️','❌','❓','❗','💡','🎯','🏆','🎁','🎉'] },
]

const THREAD_PAGE_SIZE = 100
const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'
const CONTACT_MESSAGE_COLUMNS = 'id, phone, direction, body, status, created_at, patient_id, contact_id, whatsapp_number_id, msg_type, media_url, media_mime, is_group, chat_name, chat_photo, sender_name, sender_phone, sender_lid, sender_photo, chat_lid, contact_phone, patients(full_name), crm_contacts(id, full_name, phone, status, patient_id)'
const FULL_MESSAGE_COLUMNS = 'id, phone, direction, body, status, created_at, patient_id, whatsapp_number_id, msg_type, media_url, media_mime, is_group, chat_name, chat_photo, sender_name, sender_phone, sender_lid, sender_photo, chat_lid, contact_phone, patients(full_name)'
const ROUTING_MESSAGE_COLUMNS = 'id, phone, direction, body, status, created_at, patient_id, whatsapp_number_id, msg_type, media_url, media_mime, is_group, chat_name, chat_photo, sender_name, sender_phone, sender_photo, chat_lid, contact_phone, patients(full_name)'
const IDENTITY_MESSAGE_COLUMNS = 'id, phone, direction, body, status, created_at, patient_id, whatsapp_number_id, msg_type, media_url, media_mime, is_group, chat_name, chat_photo, sender_name, sender_phone, sender_photo, patients(full_name)'
const LEGACY_MESSAGE_COLUMNS = 'id, phone, direction, body, status, created_at, patient_id, whatsapp_number_id, msg_type, media_url, media_mime, patients(full_name)'

async function selectWhatsAppMessages(configureQuery) {
  const columnSets = [CONTACT_MESSAGE_COLUMNS, FULL_MESSAGE_COLUMNS, ROUTING_MESSAGE_COLUMNS, IDENTITY_MESSAGE_COLUMNS, LEGACY_MESSAGE_COLUMNS]
  let result = null
  for (const columns of columnSets) {
    result = await configureQuery(supabase.from('whatsapp_messages').select(columns))
    if (!['PGRST200', 'PGRST204', '42703'].includes(result.error?.code)) return result
  }
  return result
}

function Icon({ name, size=20, strokeWidth=1.8 }) {
  const paths = {
    search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    attach:<path d="m20.5 11.5-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.7 9.7a2 2 0 1 1-2.8-2.8l8.9-8.9"/>,
    smile:<><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></>,
    mic:<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></>,
    stop:<rect x="7" y="7" width="10" height="10" rx="2"/>,
    send:<><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    document:<><path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></>,
    refresh:<><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-2 5"/></>,
    back:<><path d="m15 18-6-6 6-6"/><path d="M9 12h11"/></>,
    user:<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function WhatsAppLogo({ size=22 }) {
  return <svg data-testid="whatsapp-brand-logo" aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2a9.84 9.84 0 0 0-8.4 14.96L2 22l5.2-1.61A9.93 9.93 0 1 0 12.04 2Zm0 17.92a8 8 0 0 1-4.08-1.12l-.29-.17-3.09.96 1-3-.19-.31a7.94 7.94 0 1 1 6.65 3.64Zm4.36-5.94c-.24-.12-1.41-.7-1.63-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06-.24-.12-1.01-.37-1.92-1.19-.71-.63-1.19-1.42-1.33-1.66-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.51.58.18 1.1.15 1.51.09.46-.07 1.41-.58 1.61-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z"/></svg>
}

const mediaLabel = type => ({ image:'Foto', audio:'Áudio', video:'Vídeo', document:'Documento' }[type] || '')
const previewText = message => message.msg_type && message.msg_type !== 'text' ? `${mediaLabel(message.msg_type)}${message.body ? `: ${message.body}` : ''}` : message.body
const fmtTime = timestamp => { try { return new Date(timestamp).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) } catch { return '' } }
function fmtConversationTime(timestamp) {
  try {
    const date = new Date(timestamp); const today = new Date(); const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    if (date.toDateString() === today.toDateString()) return fmtTime(timestamp)
    if (date.toDateString() === yesterday.toDateString()) return 'Ontem'
    return date.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })
  } catch { return '' }
}
const dateKey = timestamp => { try { return new Date(timestamp).toDateString() } catch { return '' } }
function dateLabel(timestamp) {
  try {
    const date = new Date(timestamp); const today = new Date(); const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    if (date.toDateString() === today.toDateString()) return 'Hoje'
    if (date.toDateString() === yesterday.toDateString()) return 'Ontem'
    return date.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })
  } catch { return '' }
}
function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 13 && digits.startsWith('55')) return `+55 (${digits.slice(2,4)}) ${digits.slice(4,9)}-${digits.slice(9)}`
  if (digits.length === 12 && digits.startsWith('55')) return `+55 (${digits.slice(2,4)}) ${digits.slice(4,8)}-${digits.slice(8)}`
  return phone || ''
}
function formatPrivateParticipantId(lid) {
  const digits = String(lid || '').replace(/\D/g, '')
  return digits ? `Participante • ID ${digits.slice(-6)}` : ''
}
function participantIdentity(message) {
  const primary = message.direction === 'outbound'
    ? 'Você'
    : (message.sender_name || formatPhone(message.sender_phone) || formatPrivateParticipantId(message.sender_lid) || 'Participante')
  const secondary = message.direction === 'outbound' || !message.sender_name
    ? null
    : (formatPhone(message.sender_phone) || formatPrivateParticipantId(message.sender_lid) || null)
  return { primary, secondary }
}
function initials(name, phone) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length) return `${parts[0][0]}${parts.length > 1 ? parts.at(-1)[0] : ''}`.toUpperCase()
  return String(phone || '').slice(-2) || 'WA'
}
function isGroupPhone(phone) {
  const value = String(phone || '')
  if (/@lid$/i.test(value)) return false
  return /(?:-group|@g\.us)$/i.test(value) || value.replace(/\D/g, '').length > 15
}
const conversationKey = operationalConversationKey
function Avatar({ name, phone, photo, className='' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [photo])
  return <span className={`wa-avatar ${className}`}>{photo && !failed
    ? <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>
    : initials(name, phone)}</span>
}
function MessageStatus({ status }) {
  if (status === 'failed') return <span className="wa-status wa-status-failed" title="Falha no envio">!</span>
  if (status === 'read') return <span className="wa-status wa-status-read" title="Lida">✓✓</span>
  if (status === 'delivered') return <span className="wa-status" title="Entregue">✓✓</span>
  return <span className="wa-status" title="Enviada">✓</span>
}

export function WhatsAppInbox() {
  const { user } = useAuth()
  const { ownerId, role, isOwner } = useUserRole()
  const isAdmin = isOwner || role === 'admin'
  const [messages, setMessages] = useState([]), [numbers, setNumbers] = useState([]), [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false), [error, setError] = useState(null)
  const [selectedPhone, setSelectedPhone] = useState(null), [search, setSearch] = useState('')
  const [mobileListOpen, setMobileListOpen] = useState(false)
  const [filterNumber, setFilterNumber] = useState('all'), [filterResponsible, setFilterResponsible] = useState('all')
  const [filterMode, setFilterMode] = useState('service'), [conversationStates, setConversationStates] = useState([])
  const [savedReplies, setSavedReplies] = useState([]), [show360, setShow360] = useState(false)
  const [replyText, setReplyText] = useState(''), [showEmoji, setShowEmoji] = useState(false), [emojiGroup, setEmojiGroup] = useState('recent')
  const [replyNumberId, setReplyNumberId] = useState(''), [sending, setSending] = useState(false), [uploading, setUploading] = useState(false), [recording, setRecording] = useState(false)
  const [pendingSend, setPendingSend] = useState(null)
  const [suggestOpp, setSuggestOpp] = useState(null), [suggestBusy, setSuggestBusy] = useState(false)
  const [contactModal, setContactModal] = useState(null), [contactBusy, setContactBusy] = useState(false), [contactError, setContactError] = useState(null)
  const [contactName, setContactName] = useState(''), [leadTitle, setLeadTitle] = useState(''), [selectedPatientId, setSelectedPatientId] = useState('')
  const [olderMessages, setOlderMessages] = useState([]), [olderConversationKey, setOlderConversationKey] = useState(null)
  const [loadingOlder, setLoadingOlder] = useState(false), [hasOlder, setHasOlder] = useState(true)
  const messagesRef = useRef(null), fileRef = useRef(null), textRef = useRef(null), recRef = useRef(null), chunksRef = useRef([])
  const pendingScrollRestoreRef = useRef(null)
  const textSendRequestRef = useRef(null)

  const load = useCallback(async ({ silent=false }={}) => {
    silent ? setRefreshing(true) : setLoading(true)
    const [numRes, memRes, stateRes, replyRes] = await Promise.all([
      supabase.from('whatsapp_numbers').select('id, label, phone, assigned_user_id, active').order('created_at', { ascending:true }),
      supabase.rpc('clinic_team'),
      loadConversationStates(ownerId),
      loadSavedReplies(ownerId),
    ])
    const availableNumbers = numRes.data ?? []
    const messageResults = availableNumbers.length
      ? await Promise.all([
          ...availableNumbers.map(number => selectWhatsAppMessages(query => query.eq('whatsapp_number_id', number.id).order('created_at', { ascending:false }).limit(500))),
          selectWhatsAppMessages(query => query.is('whatsapp_number_id', null).order('created_at', { ascending:false }).limit(100)),
        ])
      : [await selectWhatsAppMessages(query => query.order('created_at', { ascending:false }).limit(500))]
    const messageError = messageResults.find(result => result.error)?.error
    if (messageError) setError(messageError.message)
    else {
      const uniqueMessages = new Map(messageResults.flatMap(result => result.data || []).map(message => [message.id, message]))
      setMessages(Array.from(uniqueMessages.values()).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)))
      setNumbers(availableNumbers)
      setMembers((memRes.data ?? []).filter(member => member.user_id))
      setConversationStates(stateRes.data || [])
      setSavedReplies(replyRes.data || [])
      setError(stateRes.error?.message || replyRes.error?.message || null)
    }
    setLoading(false); setRefreshing(false)
  }, [ownerId])
  useEffect(() => { if (ownerId) load() }, [ownerId, load])

  async function refreshConversations() {
    setRefreshing(true); setError(null)
    try {
      const { data:sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (token) {
        const response = await fetch('/api/whatsapp?action=sync-chat-identities', {
          method:'POST',
          headers:{ Authorization:`Bearer ${token}` },
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'Não foi possível atualizar nomes e fotos do WhatsApp.')
        if (result.schemaReady === false) throw new Error('A atualização de identidade do WhatsApp ainda precisa ser aplicada no banco.')
      }
    } catch (nextError) {
      setError(nextError.message)
    }
    await load({ silent:true })
  }
  useEffect(() => {
    if (!ownerId) return undefined
    const channel = supabase.channel(`whatsapp-inbox-${ownerId}`).on('postgres_changes', { event:'*', schema:'public', table:'whatsapp_messages', filter:`user_id=eq.${ownerId}` }, () => load({ silent:true })).subscribe()
    const poll = window.setInterval(() => { if (!document.hidden) load({ silent:true }) }, 12_000)
    return () => { window.clearInterval(poll); supabase.removeChannel(channel) }
  }, [ownerId, load])

  const numberLabel = useMemo(() => Object.fromEntries(numbers.map(number => [number.id, number.label])), [numbers])
  const numberOwner = useMemo(() => Object.fromEntries(numbers.map(number => [number.id, number.assigned_user_id || null])), [numbers])
  const activeNumbers = useMemo(() => numbers.filter(number => number.active), [numbers])
  const memberLabel = useMemo(() => Object.fromEntries(members.map(member => [member.user_id, (member.member_email || '').split('@')[0] || member.member_email])), [members])
  const stateMap = useMemo(() => new Map(conversationStates.map(state => [state.conversation_key, state])), [conversationStates])
  const ownerName = useCallback((numberId, assignedUserId) => { const id = assignedUserId || (numberId ? numberOwner[numberId] : null); return id ? (memberLabel[id] || 'Responsável') : null }, [numberOwner, memberLabel])
  const allConversations = useMemo(() => {
    const grouped = new Map()
    for (const message of messages) {
      const isGroup = message.is_group === true || isGroupPhone(message.phone)
      const contact = message.crm_contacts || null
      const key = conversationKey(message)
      if (!grouped.has(key)) grouped.set(key, {
        key,
        phone:isGroup ? message.phone : (message.chat_lid || message.contact_phone || message.phone),
        chatLid:message.chat_lid || null,
        contactPhone:message.contact_phone || (!/@lid$/i.test(String(message.phone || '')) ? message.phone : null),
        last:message,
        name:isGroup ? (message.chat_name || null) : (message.patients?.full_name || contact?.full_name || message.chat_name || null),
        photo:message.chat_photo || message.sender_photo || null,
        patientId:isGroup ? null : (message.patient_id || contact?.patient_id || null),
        contactId:isGroup ? null : (message.contact_id || contact?.id || null),
        contactStatus:isGroup ? null : (contact?.status || null),
        numberId:message.whatsapp_number_id,
        isGroup,
        items:[],
      })
      const conversation = grouped.get(key)
      if (!conversation.chatLid && message.chat_lid) { conversation.chatLid = message.chat_lid; conversation.phone = message.chat_lid }
      if (!conversation.contactPhone && message.contact_phone) conversation.contactPhone = message.contact_phone
      if (!conversation.name) conversation.name = isGroup ? message.chat_name : (message.patients?.full_name || contact?.full_name || message.chat_name)
      if (!conversation.photo) conversation.photo = message.chat_photo || (!isGroup ? message.sender_photo : null)
      if (!conversation.patientId) conversation.patientId = message.patient_id || contact?.patient_id || null
      if (!conversation.contactId) conversation.contactId = message.contact_id || contact?.id || null
      if (!conversation.contactStatus && contact?.status) conversation.contactStatus = contact.status
      conversation.items.push(message)
    }
    return Array.from(grouped.values()).map(conversation => {
      const state = stateMap.get(conversation.key)
      return {
        ...conversation,
        kind: conversationKind({ isGroup:conversation.isGroup, patientId:conversation.patientId, contactStatus:conversation.contactStatus }),
        assignedUserId:state?.assigned_user_id || null,
        unreadCount:unreadCountForConversation(conversation.items, state),
        archived:Boolean(state?.archived_at),
      }
    })
  }, [messages, stateMap])
  const conversations = useMemo(() => {
    let list = applyConversationFilters(allConversations, filterMode)
    if (filterNumber !== 'all') list = list.filter(conversation => conversation.items.some(message => message.whatsapp_number_id === filterNumber))
    if (filterResponsible !== 'all') list = list.filter(conversation => { const id = conversation.assignedUserId || (conversation.numberId ? numberOwner[conversation.numberId] : null); return filterResponsible === 'unassigned' ? !id : id === filterResponsible })
    const query = search.trim().toLocaleLowerCase('pt-BR')
    if (query) list = list.filter(conversation => `${conversation.name || ''} ${conversation.phone} ${previewText(conversation.last) || ''} ${conversation.items.map(item => `${item.sender_name || ''} ${item.sender_phone || ''} ${item.sender_lid || ''}`).join(' ')}`.toLocaleLowerCase('pt-BR').includes(query))
    return list
  }, [allConversations, filterMode, filterNumber, filterResponsible, numberOwner, search])
  const current = allConversations.find(conversation => conversation.key === selectedPhone) || null
  const thread = useMemo(() => {
    if (!current) return []
    const history = olderConversationKey === current.key ? olderMessages : []
    const unique = new Map([...current.items, ...history].map(message => [message.id, message]))
    return Array.from(unique.values()).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  }, [current, olderConversationKey, olderMessages])
  useEffect(() => { if (!selectedPhone && conversations[0]) setSelectedPhone(conversations[0].key); else if (selectedPhone && !allConversations.some(c => c.key === selectedPhone)) setSelectedPhone(conversations[0]?.key || null) }, [allConversations, conversations, selectedPhone])
  useEffect(() => {
    setOlderMessages([])
    setOlderConversationKey(selectedPhone)
    setHasOlder(true)
    setLoadingOlder(false)
    pendingScrollRestoreRef.current = null
  }, [selectedPhone])
  useEffect(() => {
    const container = messagesRef.current
    if (!container) return
    const restore = pendingScrollRestoreRef.current
    if (restore) {
      container.scrollTop = container.scrollHeight - restore.scrollHeight + restore.scrollTop
      pendingScrollRestoreRef.current = null
      return
    }
    container.scrollTo({ top:container.scrollHeight, behavior:'smooth' })
  }, [thread.length, selectedPhone])
  useEffect(() => {
    if (!current) return
    setReplyNumberId(activeNumbers.some(number => number.id === current.numberId) ? current.numberId : '')
    textSendRequestRef.current = null
    setPendingSend(null)
  }, [current, activeNumbers])
  useEffect(() => { setShowEmoji(false); setContactModal(null); setContactError(null); setSelectedPatientId(''); setPendingSend(null) }, [selectedPhone])
  useEffect(() => {
    if (!current || !ownerId || !current.unreadCount) return
    const timestamp = new Date().toISOString()
    setConversationStates(states => {
      const existing = states.find(state => state.conversation_key === current.key)
      const next = { ...(existing || {}), conversation_key:current.key, last_read_at:timestamp, marked_unread_at:null }
      return existing ? states.map(state => state.conversation_key === current.key ? next : state) : [...states, next]
    })
    saveConversationState(ownerId, current.key, { last_read_at:timestamp, marked_unread_at:null }, current.numberId)
  }, [current?.key, current?.last?.id, ownerId])
  useEffect(() => {
    let active = true; setSuggestOpp(null)
    if (!current?.patientId && !current?.contactId) return undefined
    ;(async () => {
      let query = supabase.from('opportunities').select('id, stage, suggested_stage, suggested_reason, suggested_confidence, suggestion_status').eq('status', 'aberto').order('created_at', { ascending:false }).limit(1)
      query = current.contactId ? query.eq('contact_id', current.contactId) : query.eq('patient_id', current.patientId)
      const { data } = await query.maybeSingle()
      if (active && data?.suggestion_status === 'pending' && data.suggested_stage) setSuggestOpp(data)
    })()
    return () => { active = false }
  }, [current?.contactId, current?.patientId])

  async function loadOlderMessages() {
    if (!current || loadingOlder || !hasOlder || !thread.length) return
    const container = messagesRef.current
    pendingScrollRestoreRef.current = container ? { scrollHeight:container.scrollHeight, scrollTop:container.scrollTop } : null
    setOlderConversationKey(current.key)
    setLoadingOlder(true); setError(null)
    const oldestTimestamp = thread[0].created_at
    const result = await selectWhatsAppMessages(query => {
      const numberScoped = current.numberId
        ? query.eq('whatsapp_number_id', current.numberId)
        : query.is('whatsapp_number_id', null)
      const scoped = numberScoped
        .lt('created_at', oldestTimestamp)
        .order('created_at', { ascending:false })
        .limit(THREAD_PAGE_SIZE)
      if (current.isGroup) return scoped.eq('phone', current.phone)
      if (current.chatLid) return scoped.eq('chat_lid', current.chatLid)
      if (current.contactPhone) return scoped.or(`phone.eq.${current.contactPhone},contact_phone.eq.${current.contactPhone}`)
      return scoped.eq('phone', current.phone)
    })
    if (result.error) {
      pendingScrollRestoreRef.current = null
      setError(`Não foi possível carregar as mensagens anteriores: ${result.error.message}`)
    } else {
      const batch = result.data ?? []
      if (!batch.length) pendingScrollRestoreRef.current = null
      setOlderMessages(existing => {
        const unique = new Map([...existing, ...batch].map(message => [message.id, message]))
        return Array.from(unique.values())
      })
      setHasOlder(batch.length === THREAD_PAGE_SIZE)
    }
    setLoadingOlder(false)
  }

  async function acceptSuggestion() { if (!suggestOpp || suggestBusy) return; setSuggestBusy(true); const { error:nextError } = await confirmSuggestion(suggestOpp); nextError ? setError('Não foi possível aplicar a sugestão.') : setSuggestOpp(null); setSuggestBusy(false) }
  async function rejectSuggestion() { if (!suggestOpp || suggestBusy) return; setSuggestBusy(true); const { error:nextError } = await dismissSuggestion(suggestOpp); nextError ? setError('Não foi possível descartar a sugestão.') : setSuggestOpp(null); setSuggestBusy(false) }
  async function postPayload(extra, target=current, sendingNumberId=replyNumberId) {
    const { data:sessionData } = E2E_BYPASS_AUTH ? { data:{ session:{ access_token:'e2e-token' } } } : await supabase.auth.getSession(); const token = sessionData.session?.access_token
    if (!token) throw new Error('Sessão inválida. Entre novamente.')
    const response = await fetch('/api/whatsapp?action=message', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` }, body:JSON.stringify({ patientId:target.patientId, contactId:target.contactId, phone:target.phone, chatLid:target.chatLid, contactPhone:target.contactPhone, isGroup:target.isGroup, whatsappNumberId:sendingNumberId, requestId:extra.requestId || crypto.randomUUID(), ...extra }) })
    const json = await response.json().catch(() => ({})); if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`); if (!json.pending) await load({ silent:true }); return json
  }
  async function patchCurrentState(patch) {
    if (!current) return
    const optimistic = { ...(stateMap.get(current.key) || {}), conversation_key:current.key, ...patch }
    setConversationStates(states => states.some(state => state.conversation_key === current.key) ? states.map(state => state.conversation_key === current.key ? optimistic : state) : [...states, optimistic])
    const result = await saveConversationState(ownerId, current.key, patch, current.numberId)
    if (result.error) setError(result.error.message)
  }
  function markCurrentUnread() {
    const latestInbound = [...(current?.items || [])].find(message => message.direction === 'inbound')
    const boundary = latestInbound ? new Date(new Date(latestInbound.created_at).getTime() - 1).toISOString() : new Date(0).toISOString()
    patchCurrentState({ marked_unread_at:boundary, last_read_at:null })
  }
  async function saveReplyFromComposer() {
    const body = replyText.trim()
    if (!body) { setError('Digite a mensagem que deseja salvar como resposta rápida.'); return }
    const title = window.prompt('Nome da resposta rápida:')?.trim()
    if (!title) return
    const { data, error:nextError } = await createSavedReply(ownerId, title, body)
    if (nextError) setError(nextError.message)
    else if (data) setSavedReplies(items => [...items, data].sort((a, b) => a.title.localeCompare(b.title)))
  }
  async function retryMessage(message) {
    if (!message?.body || message.msg_type && message.msg_type !== 'text') { setError('O reenvio direto está disponível para mensagens de texto.'); return }
    setSending(true); setError(null)
    try { await postPayload({ text:message.body }) } catch (nextError) { setError(nextError.message) }
    setSending(false)
  }
  async function send(event) {
    event?.preventDefault?.(); const body = replyText.trim(); if (!body || !current || sending) return
    if (!replyNumberId) { setError('Nenhum número configurado. Acesse Configurações → WhatsApp.'); return }
    setSending(true); setError(null)
    const requestId = textSendRequestRef.current || crypto.randomUUID()
    textSendRequestRef.current = requestId
    try {
      const result = await postPayload({ text:body, requestId })
      if (result.pending) {
        setPendingSend({ requestId, whatsappNumberId:replyNumberId, payload:{ text:body }, target:current, kind:'text' })
        setError('O WhatsApp não confirmou o envio. Confira no celular antes de liberar uma nova tentativa.')
      } else { setPendingSend(null); textSendRequestRef.current = null; setReplyText(''); if (textRef.current) textRef.current.style.height = 'auto' }
    } catch (nextError) { setError(nextError.message) }
    setSending(false)
  }
  function resizeComposer(event) { setReplyText(event.target.value); textSendRequestRef.current = null; event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px` }
  function onComposerKeyDown(event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(event) } }
  async function sendMediaFile(file, type, target=current) {
    if (!target || uploading || sending) return
    if (!replyNumberId) { setError('Nenhum número configurado. Acesse Configurações → WhatsApp.'); return }
    setUploading(true); setError(null)
    let attempt = null
    try {
      const uploaded = await uploadWhatsAppMedia(file, ownerId, { type })
      const requestId = crypto.randomUUID()
      const payload = { type:uploaded.type, mediaUrl:uploaded.url, mediaMime:uploaded.mime, fileName:uploaded.fileName, caption:'' }
      attempt = { requestId, whatsappNumberId:replyNumberId, payload, target, kind:'media' }
      const result = await postPayload({ ...payload, requestId }, target)
      if (result.pending) {
        setPendingSend(attempt)
        setError('O WhatsApp não confirmou o envio do arquivo. Confira no celular antes de liberar uma nova tentativa.')
      } else setPendingSend(null)
    } catch (nextError) {
      if (attempt) setPendingSend(attempt)
      setError(attempt ? `${nextError.message} Confira no celular antes de liberar uma nova tentativa.` : nextError.message)
    }
    setUploading(false)
  }
  async function resolveAndRetryPending() {
    if (!pendingSend || sending || uploading) return
    setSending(true); setError(null)
    try {
      const { data:sessionData } = E2E_BYPASS_AUTH ? { data:{ session:{ access_token:'e2e-token' } } } : await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) throw new Error('Sessão inválida. Entre novamente.')
      const release = await fetch('/api/whatsapp?action=resolve-send-request', {
        method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body:JSON.stringify({ requestId:pendingSend.requestId, whatsappNumberId:pendingSend.whatsappNumberId, resolution:'not_sent' }),
      })
      const released = await release.json().catch(() => ({}))
      if (!release.ok) throw new Error(released.error || `HTTP ${release.status}`)
      const result = await postPayload({ ...pendingSend.payload, requestId:pendingSend.requestId }, pendingSend.target, pendingSend.whatsappNumberId)
      if (result.pending) throw new Error('A nova tentativa também não foi confirmada. Confira novamente no celular.')
      if (pendingSend.kind === 'text') { textSendRequestRef.current = null; setReplyText(''); if (textRef.current) textRef.current.style.height = 'auto' }
      setPendingSend(null)
    } catch (nextError) { setError(nextError.message) }
    setSending(false)
  }
  function onPickFile(event) { const file = event.target.files?.[0]; event.target.value = ''; if (file) sendMediaFile(file, mediaTypeFromMime(file.type)) }
  async function toggleRecord() {
    if (recording) { recRef.current?.stop(); return }
    if (!current || !replyNumberId) { setError('Selecione uma conversa e um número para gravar.'); return }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setError('Gravação de áudio não é suportada neste navegador.'); return }
    const target = current
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true }); const mimeType = ['audio/ogg;codecs=opus','audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type => { try { return MediaRecorder.isTypeSupported(type) } catch { return false } }); const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []; recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => { stream.getTracks().forEach(track => track.stop()); setRecording(false); const mime = recorder.mimeType || 'audio/webm'; const blob = new Blob(chunksRef.current, { type:mime }); if (blob.size) { const extension = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm'; await sendMediaFile(new File([blob], `voz-${Date.now()}.${extension}`, { type:mime }), 'audio', target) } }
      recRef.current = recorder; recorder.start(); setRecording(true)
    } catch { setError('Não foi possível acessar o microfone.') }
  }
  function appendEmoji(emoji) { setReplyText(text => text + emoji); window.requestAnimationFrame(() => textRef.current?.focus()) }
  function openContactModal(type) {
    setContactModal(type)
    setContactName(current?.name || formatPhone(current?.contactPhone || current?.phone) || '')
    setLeadTitle('')
    setSelectedPatientId('')
    setContactError(null)
  }
  async function addContactToFunnel() {
    if (!current?.contactId || contactBusy) return
    setContactBusy(true); setContactError(null)
    const result = await createWhatsAppContactLead(current.contactId, leadTitle)
    setContactBusy(false)
    if (result.error) { setContactError(result.error); return }
    setContactModal(null)
    await load({ silent:true })
  }
  async function convertCurrentContact(patientId = null) {
    if (!current?.contactId || contactBusy) return
    if (!patientId && !contactName.trim()) { setContactError('Informe o nome do novo paciente.'); return }
    setContactBusy(true); setContactError(null)
    const result = await convertContactToPatient(current.contactId, { patientId, name:contactName })
    setContactBusy(false)
    if (result.error) { setContactError(result.error); return }
    setContactModal(null)
    await load({ silent:true })
  }
  async function toggleIgnored(ignored) {
    if (!current?.contactId || contactBusy) return
    setContactBusy(true); setError(null)
    const result = await setContactIgnored(current.contactId, ignored)
    setContactBusy(false)
    if (result.error) { setError(result.error); return }
    await load({ silent:true })
  }
  function openConversation(key) { textSendRequestRef.current = null; setSelectedPhone(key); setMobileListOpen(false) }
  function returnToConversationList() { setMobileListOpen(true); setShowEmoji(false) }
  function renderBody(message) {
    const type = message.msg_type || 'text'
    const fallback = <span className="wa-message-text">{message.body || 'Mídia indisponível'}</span>
    if (type === 'image' && message.media_url) return <WhatsAppMedia message={message} fallback={fallback}>{url => <><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={message.body || 'Imagem recebida'} className="wa-media-image" /></a>{message.body && <div className="wa-caption">{message.body}</div>}</>}</WhatsAppMedia>
    if (type === 'audio' && message.media_url) return <WhatsAppMedia message={message} fallback={fallback}>{url => <audio controls src={url} className="wa-media-audio" />}</WhatsAppMedia>
    if (type === 'video' && message.media_url) return <WhatsAppMedia message={message} fallback={fallback}>{url => <><video controls src={url} className="wa-media-image" />{message.body && <div className="wa-caption">{message.body}</div>}</>}</WhatsAppMedia>
    if (type === 'document' && message.media_url) return <WhatsAppMedia message={message} fallback={fallback}>{url => <a href={url} target="_blank" rel="noreferrer" className="wa-document"><span className="wa-document-icon"><Icon name="document" /></span><span><strong>{message.body || 'Documento'}</strong><small>Abrir arquivo</small></span></a>}</WhatsAppMedia>
    return <span className="wa-message-text">{message.body}</span>
  }
  if (loading) return <div className="wa-loading"><span className="wa-spinner" />Carregando conversas…</div>
  const activeEmojiGroup = EMOJI_GROUPS.find(group => group.id === emojiGroup) || EMOJI_GROUPS[0]

  return <div className={`wa-inbox ${current && !mobileListOpen ? 'wa-has-chat' : 'wa-show-list'}`}>
    <aside className="wa-sidebar">
      <div className="wa-sidebar-top">
        <div className="wa-sidebar-title"><span className="wa-brand-icon" aria-label="WhatsApp"><WhatsAppLogo size={23}/></span><div><strong>Conversas</strong><small>{allConversations.length} {allConversations.length === 1 ? 'conversa' : 'conversas'}</small></div><button type="button" className={`wa-icon-button wa-refresh ${refreshing ? 'is-spinning' : ''}`} onClick={refreshConversations} title="Atualizar mensagens, nomes e fotos" aria-label="Atualizar conversas"><Icon name="refresh" size={18}/></button></div>
        <label className="wa-search"><Icon name="search" size={17}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar conversa ou mensagem"/>{search && <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca">×</button>}</label>
        <div className="wa-queue-tabs">{[['service','Atendimentos'],['unread','Não lidas'],['leads','Leads'],['patients','Pacientes'],['groups','Grupos'],['archived','Arquivadas']].map(([id,label]) => <button type="button" key={id} className={filterMode === id ? 'is-active' : ''} onClick={() => setFilterMode(id)}>{label}</button>)}</div>
        <div className="wa-filters"><select value={filterNumber} onChange={event => setFilterNumber(event.target.value)} title="Filtrar por número"><option value="all">Todos os números</option>{numbers.map(number => <option key={number.id} value={number.id}>{number.label}{number.active ? '' : ' (inativo)'}</option>)}</select>{isAdmin && <select value={filterResponsible} onChange={event => setFilterResponsible(event.target.value)} title="Monitorar por responsável"><option value="all">Toda a equipe</option>{members.map(member => <option key={member.user_id} value={member.user_id}>{memberLabel[member.user_id]}</option>)}<option value="unassigned">Sem responsável</option></select>}</div>
      </div>
      <div className="wa-conversation-list" aria-label="Lista de conversas">{conversations.length === 0 ? <div className="wa-list-empty"><Icon name="search" size={26}/><strong>Nenhuma conversa encontrada</strong><span>Ajuste a busca ou os filtros.</span></div> : conversations.map(conversation => {
        const responsible = ownerName(conversation.numberId, conversation.assignedUserId), active = conversation.key === selectedPhone
        const title = conversation.name || (conversation.isGroup ? 'Grupo do WhatsApp' : (conversation.contactPhone ? formatPhone(conversation.contactPhone) : 'Contato do WhatsApp'))
        const lastParticipant = participantIdentity(conversation.last).primary
        const preview = conversation.isGroup && conversation.last.direction === 'inbound'
          ? `${lastParticipant}: ${previewText(conversation.last)}`
          : previewText(conversation.last)
        return <button type="button" key={conversation.key} className={`wa-conversation ${active ? 'is-active' : ''} ${conversation.unreadCount ? 'is-unread' : ''}`} onClick={() => openConversation(conversation.key)}><Avatar name={title} phone={conversation.contactPhone || conversation.phone} photo={conversation.photo}/><span className="wa-conversation-content"><span className="wa-conversation-line"><strong>{title}</strong><time>{fmtConversationTime(conversation.last.created_at)}</time>{conversation.unreadCount > 0 && <b className="wa-unread-badge">{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</b>}</span><span className="wa-preview"><span className={`wa-direction-dot ${conversation.last.direction}`}/>{preview}</span><span className="wa-chips">{conversation.isGroup && <span className="wa-chip-group">grupo</span>}{!conversation.isGroup && <span className={`wa-chip-kind is-${conversation.kind}`}>{CONVERSATION_KIND_LABEL[conversation.kind]}</span>}{conversation.numberId && numberLabel[conversation.numberId] && <span>{numberLabel[conversation.numberId]}</span>}{responsible && <span className="wa-chip-owner">{responsible}</span>}{isAdmin && !conversation.assignedUserId && !numberOwner[conversation.numberId] && <span className="wa-chip-warning">sem responsável</span>}</span></span></button>
      })}</div>
    </aside>
    <section className="wa-chat">{!current ? <div className="wa-chat-empty"><span className="wa-empty-logo"><WhatsAppLogo size={48}/></span><h3>Seu atendimento em um só lugar</h3><p>Selecione uma conversa para visualizar o histórico e responder.</p></div> : <>
      <header className="wa-chat-header">
        <button type="button" className="wa-icon-button wa-back" onClick={returnToConversationList} aria-label="Voltar para conversas"><Icon name="back"/></button>
        <Avatar className="wa-avatar-header" name={current.name || (current.isGroup ? 'Grupo do WhatsApp' : 'Contato do WhatsApp')} phone={current.contactPhone || current.phone} photo={current.photo}/>
        <div className="wa-chat-person"><strong>{current.name || (current.isGroup ? 'Grupo do WhatsApp' : 'Contato do WhatsApp')}</strong><span>{current.isGroup ? 'Conversa em grupo' : (current.contactPhone ? formatPhone(current.contactPhone) : 'Identificador privado do WhatsApp')}{numberLabel[current.numberId] ? ` • ${numberLabel[current.numberId]}` : ''}</span></div>
        <div className="wa-chat-tags">{current.isGroup && <span className="is-group">grupo</span>}{!current.isGroup && <span className={`is-${current.kind}`}>{CONVERSATION_KIND_LABEL[current.kind]}</span>}{ownerName(current.numberId, current.assignedUserId) && <span><Icon name="user" size={13}/>{ownerName(current.numberId, current.assignedUserId)}</span>}</div>
        <div className="wa-thread-actions"><select aria-label="Responsável pela conversa" value={current.assignedUserId || ''} onChange={event => patchCurrentState({ assigned_user_id:event.target.value || null })}><option value="">Sem responsável</option>{members.map(member => <option key={member.user_id} value={member.user_id}>{memberLabel[member.user_id]}</option>)}</select>{!current.isGroup && <button type="button" onClick={() => setShow360(true)}>360°</button>}<button type="button" onClick={markCurrentUnread}>Não lida</button><button type="button" onClick={() => patchCurrentState({ archived_at:current.archived ? null : new Date().toISOString() })}>{current.archived ? 'Desarquivar' : 'Arquivar'}</button></div>
        {!current.isGroup && current.contactId && <div className="wa-contact-actions">
          {current.kind === 'contact' && <button type="button" onClick={() => openContactModal('lead')} title="Adicionar ao funil" aria-label="Adicionar ao funil"><span className="wa-action-icon">＋</span><span className="wa-action-label">Funil</span></button>}
          {['contact','lead'].includes(current.kind) && <button type="button" onClick={() => openContactModal('patient')} title="Cadastrar ou vincular paciente" aria-label="Cadastrar ou vincular paciente"><Icon name="user" size={14}/><span className="wa-action-label">Paciente</span></button>}
          {current.kind === 'contact' && <button type="button" className="is-muted" onClick={() => toggleIgnored(true)} disabled={contactBusy} title="Ignorar contato" aria-label="Ignorar contato"><span className="wa-action-icon">×</span><span className="wa-action-label">Ignorar</span></button>}
          {current.kind === 'ignored' && <button type="button" onClick={() => toggleIgnored(false)} disabled={contactBusy} title="Reativar contato" aria-label="Reativar contato"><span className="wa-action-icon">↺</span><span className="wa-action-label">Reativar</span></button>}
        </div>}
      </header>
      {suggestOpp && <div className="wa-suggestion"><SuggestionBox opp={suggestOpp} disabled={suggestBusy} onAccept={acceptSuggestion} onReject={rejectSuggestion}/></div>}
      {error && <div className="wa-error"><span>!</span><p>{error}</p>{pendingSend && <button type="button" onClick={resolveAndRetryPending} disabled={sending || uploading}>Confirmo que não chegou e tentar novamente</button>}<button type="button" onClick={() => setError(null)} aria-label="Fechar erro">×</button></div>}
      <div ref={messagesRef} className="wa-messages" role="log" aria-label={`Mensagens com ${current.name || current.phone}`} tabIndex="0"><div className="wa-history-loader">{hasOlder
        ? <button type="button" onClick={loadOlderMessages} disabled={loadingOlder}>{loadingOlder ? 'Carregando histórico…' : 'Carregar mensagens anteriores'}</button>
        : <span>Início do histórico salvo</span>}</div>{thread.map((message, index) => {
        const showDate = index === 0 || dateKey(thread[index - 1].created_at) !== dateKey(message.created_at)
        const participant = participantIdentity(message)
        return <div key={message.id} className="wa-message-block">{showDate && <div className="wa-date-separator"><span>{dateLabel(message.created_at)}</span></div>}<div className={`wa-message-row ${message.direction}`}>{current.isGroup && message.direction === 'inbound' && <Avatar className="wa-participant-avatar" name={participant.primary} phone={message.sender_phone || message.sender_lid} photo={message.sender_photo}/>}<div className={`wa-bubble ${message.direction} ${message.status === 'failed' ? 'is-failed' : ''}`}>{current.isGroup && <span className="wa-participant-name">{participant.primary}{participant.secondary ? <small>{participant.secondary}</small> : null}</span>}{renderBody(message)}<span className="wa-message-meta"><time>{fmtTime(message.created_at)}</time>{message.direction === 'outbound' && <MessageStatus status={message.status}/>}</span>{message.status === 'failed' && <button type="button" className="wa-retry" onClick={() => retryMessage(message)}>Tentar novamente</button>}</div></div></div>
      })}</div>
      <form className="wa-composer" onSubmit={send}><div className="wa-composer-tools">{activeNumbers.length > 0 && <label className="wa-reply-number"><span>Enviar por</span><select value={replyNumberId} onChange={event => { setReplyNumberId(event.target.value); textSendRequestRef.current = null; setPendingSend(null) }}><option value="">Selecione um número ativo</option>{activeNumbers.map(number => <option key={number.id} value={number.id}>{number.label}</option>)}</select></label>}<select aria-label="Respostas rápidas" defaultValue="" onChange={event => { const reply = savedReplies.find(item => item.id === event.target.value); if (reply) { setReplyText(reply.body); textSendRequestRef.current = null } event.target.value = '' }}><option value="">Respostas rápidas</option>{savedReplies.map(reply => <option key={reply.id} value={reply.id}>{reply.title}</option>)}</select><button type="button" onClick={saveReplyFromComposer}>Salvar resposta atual</button></div><div className="wa-composer-row">
        <input ref={fileRef} type="file" accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip" hidden onChange={onPickFile}/><button type="button" className="wa-icon-button wa-composer-button" onClick={() => fileRef.current?.click()} disabled={uploading || recording} title="Anexar mídia ou documento" aria-label="Anexar arquivo"><Icon name="attach"/></button>
        <div className="wa-emoji-anchor"><button type="button" className={`wa-icon-button wa-composer-button ${showEmoji ? 'is-active' : ''}`} onClick={() => setShowEmoji(value => !value)} title="Emoji" aria-label="Inserir emoji"><Icon name="smile"/></button>{showEmoji && <div className="wa-emoji-picker"><div className="wa-emoji-tabs">{EMOJI_GROUPS.map(group => <button key={group.id} type="button" className={emojiGroup === group.id ? 'is-active' : ''} onClick={() => setEmojiGroup(group.id)} title={group.label}>{group.icon}</button>)}</div><div className="wa-emoji-title">{activeEmojiGroup.label}</div><div className="wa-emoji-grid">{activeEmojiGroup.items.map((emoji, index) => <button key={`${emoji}-${index}`} type="button" onClick={() => appendEmoji(emoji)} aria-label={emoji}>{emoji}</button>)}</div></div>}</div>
        <div className="wa-textarea-wrap"><textarea ref={textRef} rows="1" value={replyText} onChange={resizeComposer} onKeyDown={onComposerKeyDown} placeholder={uploading ? 'Enviando arquivo…' : recording ? 'Gravando áudio…' : 'Responder...'} disabled={sending || uploading || recording}/><small>Enter envia • Shift + Enter quebra linha</small></div>
        {!replyText.trim() && <button type="button" className={`wa-icon-button wa-composer-button ${recording ? 'is-recording' : ''}`} onClick={toggleRecord} disabled={uploading} title={recording ? 'Parar e enviar' : 'Gravar áudio'} aria-label={recording ? 'Parar gravação' : 'Gravar áudio'}><Icon name={recording ? 'stop' : 'mic'}/></button>}{replyText.trim() && <button type="submit" className="wa-send-button" disabled={sending || uploading || recording} aria-label="Enviar mensagem"><Icon name="send" size={19}/>{sending && <span className="wa-send-spinner"/>}</button>}
      </div></form>
    </>}</section>
    <Modal open={contactModal === 'lead'} onClose={() => !contactBusy && setContactModal(null)} title="Adicionar contato ao funil" width={440}>
      <div className="wa-contact-modal">
        <p>Será criada uma oportunidade em <strong>Primeiro contato</strong>. Isso não cadastra a pessoa como paciente.</p>
        {contactError && <div className="wa-contact-modal-error" role="alert">{contactError}</div>}
        <FInput label="Interesse / oportunidade" value={leadTitle} onChange={setLeadTitle} placeholder="Ex.: Rinoplastia" />
        <div className="wa-contact-modal-actions"><Btn variant="ghost" onClick={() => setContactModal(null)} disabled={contactBusy}>Cancelar</Btn><Btn onClick={addContactToFunnel} disabled={contactBusy}>{contactBusy ? 'Adicionando…' : 'Adicionar ao funil'}</Btn></div>
      </div>
    </Modal>
    <Modal open={contactModal === 'patient'} onClose={() => !contactBusy && setContactModal(null)} title="Cadastrar ou vincular paciente" width={480}>
      <div className="wa-contact-modal">
        <p>Crie um paciente somente após confirmar a identidade, ou vincule esta conversa a um cadastro existente.</p>
        {contactError && <div className="wa-contact-modal-error" role="alert">{contactError}</div>}
        <FInput label="Nome do novo paciente" value={contactName} onChange={setContactName} placeholder="Nome completo" />
        <Btn onClick={() => convertCurrentContact()} disabled={contactBusy || !contactName.trim()}>{contactBusy ? 'Salvando…' : 'Criar novo paciente'}</Btn>
        <div className="wa-contact-divider"><span>ou vincule a um cadastro existente</span></div>
        <PatientSelector userId={ownerId} value={selectedPatientId} onChange={id => setSelectedPatientId(id)} label="Paciente existente" />
        <div className="wa-contact-modal-actions"><Btn variant="ghost" onClick={() => setContactModal(null)} disabled={contactBusy}>Cancelar</Btn><Btn onClick={() => convertCurrentContact(selectedPatientId)} disabled={contactBusy || !selectedPatientId}>Vincular selecionado</Btn></div>
      </div>
    </Modal>
    <Person360Drawer open={show360} onClose={() => setShow360(false)} contactId={current?.contactId} patientId={current?.patientId} name={current?.name} phone={formatPhone(current?.contactPhone || current?.phone)} />
  </div>
}
