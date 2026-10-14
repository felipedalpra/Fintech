import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { C } from '../theme.js'
import { fmt, startOfMonth, today } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, SkeletonBlock } from '../components/UI.jsx'
import { Dashboard } from '../components/Dashboard.jsx'
import { Sales } from '../components/Sales.jsx'
import { Plans } from '../components/Plans.jsx'
import { Products } from '../components/Products.jsx'
import { Finance, FINANCE_MODAL_DRAFT_KEY } from '../components/Finance.jsx'
import { Goals } from '../components/Goals.jsx'
import { AIAssistant } from '../components/AIAssistant.jsx'
import { Consultations } from '../components/Consultations.jsx'
import { Reports } from '../components/Reports.jsx'
import { LedgerCheck } from '../components/LedgerCheck.jsx'
import { Recurrences } from '../components/Recurrences.jsx'
import { ChartOfAccounts } from '../components/ChartOfAccounts.jsx'
import { Settings } from '../components/Settings.jsx'
import { CopilotWidget } from '../components/CopilotWidget.jsx'
import { FAB } from '../components/FAB.jsx'
import { BrandLogo } from '../components/BrandLogo.jsx'
import { NavIcon } from '../components/NavIcon.jsx'
import { AlertsBell } from '../components/AlertsBell.jsx'
import { CrmBell } from '../components/CrmBell.jsx'
import { BillingPage } from './BillingPage.jsx'
import { Calendar } from '../components/Calendar.jsx'
import { Patients } from '../components/Patients.jsx'
import { OpportunityPipeline } from '../components/OpportunityPipeline.jsx'
import { CrmDashboard } from '../components/CrmDashboard.jsx'
import { MeuDia } from '../components/MeuDia.jsx'
import { WhatsAppInbox } from '../components/WhatsAppInbox.jsx'
import { MetaAdsDashboard } from '../components/MetaAdsDashboard.jsx'
import { TasksPanel } from '../components/TasksPanel.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useBilling } from '../context/BillingContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { createEmptyData, normalizeData } from '../dataModel.js'
import { importLegacyDataIfNeeded, saveFinanceData } from '../lib/financeStore.js'
import { mergePendingFinanceSave } from '../lib/pendingFinanceSave.js'
import { createSerializedTaskQueue } from '../lib/serializedTaskQueue.js'
import { useGoogleCalendarSync } from '../lib/useGoogleCalendarSync.js'

// Navegação por ÁREAS de domínio (spec de arquitetura, seção 4).
// Cada área tem uma barra no topo; a sidebar mostra a sub-navegação da área ativa.
// `roles` controla a visibilidade da área na barra; `comingSoon` = área sem features ainda (Fases 2/4).
// IA não é item de menu — vive no CopilotWidget global.
const ALL_ROLES = ['admin', 'gestao', 'concierge', 'equipe']

const AREAS = [
  {
    id:'inicio', label:'Início', icon:'dashboard', roles:ALL_ROLES,
    sections:[
      { title:null, items:[
        { id:'dashboard', label:'Dashboard', icon:'dashboard', hint:'Visão geral da clínica' },
        { id:'meu-dia', label:'Meu dia', icon:'tasks', hint:'Suas tarefas, leads e pendências de hoje' },
      ] },
    ],
  },
  {
    id:'pacientes', label:'Pacientes', icon:'patients', roles:ALL_ROLES,
    sections:[
      { title:'CRM & Jornada', items:[
        { id:'funnel',   label:'Funil',     icon:'funnel',   hint:'Jornada dos pacientes por estágio' },
        { id:'crm-painel', label:'Painel CRM', icon:'reports', hint:'Conversão, origem e desempenho do funil' },
        { id:'patients', label:'Pacientes', icon:'patients', hint:'Cadastro clínico e prontuários' },
        { id:'calendar', label:'Agenda',    icon:'calendar', hint:'Calendário de cirurgias e consultas' },
        { id:'inbox',    label:'WhatsApp',  icon:'chat',     hint:'Caixa de entrada de todas as conversas' },
        { id:'ads',      label:'Anúncios',  icon:'reports',  hint:'Desempenho dos anúncios do Meta' },
        { id:'tarefas',  label:'Tarefas',   icon:'tasks',    hint:'Tarefas e follow-ups da equipe' },
      ] },
      { title:'Atendimentos', items:[
        { id:'consultations', label:'Consultas', icon:'consultations', hint:'Atendimentos e convênios' },
        { id:'sales',         label:'Cirurgias', icon:'surgery',       hint:'Agenda e resultados' },
      ] },
    ],
  },
  {
    id:'clinico', label:'Clínico', icon:'clinico', roles:['admin', 'gestao'], comingSoon:true,
    sections:[],
  },
  {
    id:'financeiro', label:'Financeiro', icon:'finance', roles:['admin', 'gestao'],
    sections:[
      { title:'Movimento', items:[
        { id:'finance', label:'Financeiro', icon:'finance', hint:'Caixa, DRE e balanço' },
      ] },
      { title:'Operação', items:[
        { id:'products',      label:'Produtos',      icon:'products',      hint:'Modeladores e estoque' },
        { id:'plans',         label:'Procedimentos', icon:'procedures',    hint:'Catálogo cirúrgico' },
        { id:'recurrences',   label:'Recorrências',  icon:'recurrences',   hint:'Despesas e receitas fixas' },
        { id:'chart-of-accounts', label:'Plano de contas', icon:'reports', hint:'Estrutura de grupos e categorias financeiras' },
      ] },
      { title:'Análise', items:[
        { id:'goals',    label:'Metas',      icon:'goals',   hint:'Objetivos e acompanhamento' },
        { id:'reports',  label:'Relatórios', icon:'reports', hint:'Central de exportações em Excel' },
        { id:'ledger-check', label:'Conferência do razão', icon:'reports', hint:'Validação razão × dashboard' },
      ] },
    ],
  },
  {
    id:'automacoes', label:'Automações', icon:'automacoes', roles:['admin'], comingSoon:true,
    sections:[],
  },
  {
    id:'config', label:'Configurações', icon:'settings', roles:['admin'],
    sections:[
      { title:null, items:[
        { id:'settings', label:'Configurações', icon:'settings', hint:'Perfil e preferências' },
        { id:'billing',  label:'Assinatura',    icon:'billing',  hint:'Trial, checkout e cobrança' },
      ] },
    ],
  },
]

// Todos os itens de todas as áreas (para resolução de página / compat).
const ALL_NAV_ITEMS = AREAS.flatMap(a => a.sections).flatMap(s => s.items)
const COMING_SOON = AREAS.filter(a => a.comingSoon)

// Descrição de cada área "em breve" (placeholder).
const AREA_SOON_HINT = {
  clinico:'Prontuário, anamnese, pedido de exames, receituário e documentos com assinatura chegam na Fase 4.',
  automacoes:'Automações de WhatsApp, régua do funil, cobrança, monitoramento e integrações chegam nas Fases 2 e 3.',
}

// Área que contém uma página (aliases do Financeiro resolvem para a área Financeiro).
function areaIdForPage(pageId) {
  const pid = FINANCE_ALIASES.has(pageId) ? 'finance' : pageId
  return AREAS.find(a => a.sections.some(s => s.items.some(i => i.id === pid)))?.id
}

const TITLES = {
  dashboard:'Dashboard Executivo',
  'meu-dia':'Meu dia',
  plans:'Procedimentos',
  sales:'Cirurgias',
  consultations:'Consultas',
  calendar:'Agenda',
  products:'Modeladores e Produtos Pós-Operatórios',
  finance:'Financeiro',
  cashflow:'Fluxo de Caixa',
  dre:'DRE',
  balance:'Balanço Patrimonial',
  goals:'Metas',
  recurrences:'Recorrências',
  reports:'Central de Relatórios',
  'ledger-check':'Conferência do Razão',
  'chart-of-accounts':'Plano de Contas',
  ai:'Central de IA',
  billing:'Assinatura',
  settings:'Configurações',
  patients:'Pacientes',
  funnel:'Pipeline de Oportunidades',
  'crm-painel':'Painel de CRM',
  inbox:'WhatsApp',
  ads:'Anúncios — Meta Ads',
  tarefas:'Tarefas',
  'Agenda':'Agenda da Clínica',
}

const SUBTITLES = {
  dashboard:'Indicadores-chave e leitura rápida da operação.',
  'meu-dia':'O que você precisa resolver hoje: tarefas, leads novos atribuídos a você e oportunidades paradas.',
  plans:'Organize o portfólio de procedimentos da clínica.',
  sales:'Cadastre cirurgias e acompanhe margem por operação.',
  consultations:'Controle consultas, convênios e recebimentos.',
  calendar:'Visualize cirurgias e consultas no calendário.',
  products:'Gerencie modeladores, compras, vendas e estoque.',
  finance:'Centralize entradas, saídas, contas, DRE e balanço.',
  cashflow:'Movimentações realizadas e saldo por período.',
  dre:'Resultado do período por competência.',
  balance:'Ativos, passivos e patrimônio da clínica.',
  goals:'Metas financeiras com progresso automático.',
  recurrences:'Cadastre receitas e despesas fixas com geração automática.',
  reports:'Exporte dados financeiros, operacionais, de estoque e clientes em Excel.',
  'ledger-check':'Audita a fonte financeira canônica e sua consistência com os indicadores.',
  'chart-of-accounts':'Organize grupos e categorias usados nos lançamentos e relatórios.',
  ai:'Previsões, diagnósticos e recomendações em tópicos.',
  billing:'Gerencie a sua assinatura.',
  settings:'Ajuste perfil e preferências da plataforma.',
  patients:'Cadastro clínico CFM, prontuário eletrônico e histórico financeiro.',
  funnel:'Oportunidades (negócios) por estágio: consulta agendada → consultado → orçamento → reserva paga → follow-up.',
  'crm-painel':'Conversão por etapa, origem e responsável, pipeline ponderado e motivos de perda — sem cruzar o financeiro.',
  inbox:'Todas as conversas de WhatsApp da clínica, inclusive de números ainda não cadastrados como paciente.',
  ads:'Desempenho dos anúncios do Meta (Facebook/Instagram) por campanha, conjunto e anúncio.',
  tarefas:'Tarefas e follow-ups da equipe — de qualquer oportunidade ou avulsas, agrupadas por vencimento.',
}

const PAGES = {
  dashboard:Dashboard,
  'meu-dia':MeuDia,
  plans:Plans,
  sales:Sales,
  consultations:Consultations,
  calendar:Calendar,
  products:Products,
  finance:props => <Finance {...props} defaultTab="entradas" />,
  cashflow:props => <Finance {...props} defaultTab="fluxo" />,
  dre:props => <Finance {...props} defaultTab="dre" />,
  balance:props => <Finance {...props} defaultTab="balanco" />,
  goals:Goals,
  recurrences:Recurrences,
  reports:Reports,
  'ledger-check':LedgerCheck,
  'chart-of-accounts':ChartOfAccounts,
  ai:AIAssistant,
  billing:BillingPage,
  settings:Settings,
  patients:Patients,
  funnel:OpportunityPipeline,
  'crm-painel':CrmDashboard,
  inbox:WhatsAppInbox,
  ads:MetaAdsDashboard,
  tarefas:TasksPanel,
}

const FINANCE_ALIASES = new Set(['cashflow', 'dre', 'balance'])
const LAST_APP_PATH_KEY = 'surgimetrics_last_app_path'
const DRAFT_STORAGE_PREFIX = 'surgimetrics_workspace_draft_'
const PENDING_SAVE_STORAGE_PREFIX = 'surgimetrics_pending_finance_save_'

function getDraftStorageKey(userId) {
  return `${DRAFT_STORAGE_PREFIX}${userId}`
}

function getPendingSaveStorageKey(userId) {
  return `${PENDING_SAVE_STORAGE_PREFIX}${userId}`
}

function readPendingSave(userId) {
  if (typeof window === 'undefined' || !userId) return null
  try {
    const raw = window.localStorage.getItem(getPendingSaveStorageKey(userId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writePendingSave(userId, pendingSave) {
  if (typeof window === 'undefined' || !userId) return
  try {
    window.localStorage.setItem(getPendingSaveStorageKey(userId), JSON.stringify(pendingSave))
  } catch {
    // O beforeunload ainda protege a saida quando o armazenamento local estiver indisponivel.
  }
}

function clearPendingSave(userId, pendingId) {
  if (typeof window === 'undefined' || !userId) return
  try {
    const current = readPendingSave(userId)
    if (!pendingId || current?.pendingId === pendingId) {
      window.localStorage.removeItem(getPendingSaveStorageKey(userId))
    }
  } catch {
    // Nao bloquear uma gravacao confirmada por falha ao limpar o cache local.
  }
}

function clearFinanceModalDraft() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(FINANCE_MODAL_DRAFT_KEY)
  window.sessionStorage.removeItem(FINANCE_MODAL_DRAFT_KEY)
}

// ---- QuickSearchModal ----
function QuickSearchModal({ open, onClose, navigate, sections }) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)

  const allItems = useMemo(() => (sections ?? [{ items: ALL_NAV_ITEMS }]).flatMap(s => s.items), [sections])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allItems
    return allItems.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.hint.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q)
    )
  }, [query, allItems])

  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const select = item => {
    navigate(`/app/${item.id}`)
    onClose()
  }

  const onKeyDown = e => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[activeIdx]) select(filtered[activeIdx])
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position:'fixed',
        inset:0,
        background:'rgba(0,0,0,0.72)',
        display:'flex',
        alignItems:'flex-start',
        justifyContent:'center',
        zIndex:2000,
        padding:'80px 20px 20px',
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background:C.card,
        border:`1px solid ${C.borderBright}`,
        borderRadius:18,
        width:'100%',
        maxWidth:520,
        boxShadow:'0 24px 80px rgba(0,0,0,0.7)',
        overflow:'hidden',
      }}>
        {/* Search input */}
        <div style={{
          display:'flex',
          alignItems:'center',
          gap:10,
          padding:'14px 18px',
          borderBottom:`1px solid ${C.border}`,
        }}>
          <span style={{ fontSize:16, color:C.textDim, flexShrink:0 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar página…"
            style={{
              flex:1,
              background:'transparent',
              border:'none',
              outline:'none',
              color:C.text,
              fontSize:15,
              fontFamily:'inherit',
            }}
          />
          <kbd style={getKbdSmall()}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight:340, overflowY:'auto', padding:'8px 0' }}>
          {filtered.length === 0 && (
            <div style={{ padding:'20px 18px', color:C.textDim, fontSize:13, textAlign:'center' }}>
              Nenhuma página encontrada.
            </div>
          )}
          {filtered.map((item, idx) => (
            <button
              key={item.id}
              onClick={() => select(item)}
              onMouseEnter={() => setActiveIdx(idx)}
              style={{
                display:'grid',
                gridTemplateColumns:'26px 1fr',
                gap:12,
                alignItems:'center',
                padding:'11px 18px',
                width:'100%',
                textAlign:'left',
                background:idx === activeIdx ? C.accent + '18' : 'transparent',
                border:'none',
                color:idx === activeIdx ? C.text : C.textSub,
                fontSize:13,
                cursor:'pointer',
                fontFamily:'inherit',
                transition:'background 0.1s',
              }}
            >
              <span style={{ display:'flex', alignItems:'center', justifyContent:'center', opacity:0.7 }}>
                <NavIcon name={item.icon} size={16} />
              </span>
              <span>
                <span style={{ display:'block', fontWeight:idx === activeIdx ? 700 : 500 }}>{item.label}</span>
                <span style={{ display:'block', fontSize:11, color:C.textDim, marginTop:2 }}>{item.hint}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{
          display:'flex',
          gap:16,
          padding:'10px 18px',
          borderTop:`1px solid ${C.border}`,
          fontSize:11,
          color:C.textDim,
        }}>
          <span><kbd style={getKbdSmall()}>↑↓</kbd> navegar</span>
          <span><kbd style={getKbdSmall()}>↵</kbd> selecionar</span>
          <span><kbd style={getKbdSmall()}>Esc</kbd> fechar</span>
        </div>
      </div>
    </div>
  )
}

// ---- OnboardingWizard ----
function OnboardingWizard({ onClose }) {
  const [step, setStep] = useState(0)

  const steps = [
    {
      icon:'👋',
      title:'Bem-vindo ao SurgiMetrics!',
      body:'SurgiMetrics é o ERP financeiro completo para clínicas de cirurgia plástica. Aqui você controla cirurgias, consultas, produtos, despesas, metas e muito mais — tudo integrado e automático.',
      bodyNode:null,
      action:'Começar',
    },
    {
      icon:'◇',
      title:'Cadastre seu primeiro procedimento',
      body:null,
      bodyNode:(
        <div style={{ display:'flex', flexDirection:'column', gap:14, alignItems:'center', marginTop:8 }}>
          <div style={{ fontSize:48, lineHeight:1, filter:'drop-shadow(0 0 12px rgba(59,130,246,0.4))' }}>◇</div>
          <p style={{ fontSize:14, color:C.textSub, textAlign:'center', margin:0, lineHeight:1.7 }}>
            Vá em <strong style={{ color:C.text }}>Procedimentos → + Novo Procedimento</strong> para criar seu catálogo cirúrgico.<br />
            Os procedimentos serão usados ao registrar cirurgias, calcular margens e gerar relatórios automaticamente.
          </p>
        </div>
      ),
      action:'Entendido',
    },
    {
      icon:'◈',
      title:'Registre sua primeira cirurgia',
      body:'No módulo Cirurgias você registra cada operação com o procedimento, paciente, valores, custos (hospital, anestesia, material) e status de pagamento. O sistema atualiza fluxo de caixa, DRE, balanço patrimonial e metas em tempo real.',
      bodyNode:null,
      action:'Vamos lá!',
    },
  ]

  const current = steps[step]
  const isLast = step === steps.length - 1

  const handleAction = () => {
    if (isLast) {
      localStorage.setItem('surgimetrics_onboarded', 'true')
      onClose()
    } else {
      setStep(s => s + 1)
    }
  }

  return (
    <div style={{
      position:'fixed',
      inset:0,
      background:'rgba(0,0,0,0.82)',
      display:'flex',
      alignItems:'center',
      justifyContent:'center',
      zIndex:3000,
      padding:20,
    }}>
      <div style={{
        background:`linear-gradient(160deg, ${C.surface}, ${C.card})`,
        border:`1px solid ${C.borderBright}`,
        borderRadius:24,
        padding:'36px 32px',
        width:'100%',
        maxWidth:480,
        boxShadow:'0 32px 100px rgba(0,0,0,0.8)',
        display:'flex',
        flexDirection:'column',
        alignItems:'center',
      }}>
        {/* Step dots */}
        <div style={{ display:'flex', gap:8, marginBottom:28 }}>
          {steps.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 24 : 8,
              height:8,
              borderRadius:99,
              background: i === step ? C.accent : i < step ? C.green : C.border,
              transition:'all 0.3s ease',
            }} />
          ))}
        </div>

        {/* Icon */}
        <div style={{ fontSize:52, marginBottom:16, lineHeight:1, textAlign:'center' }}>{current.icon}</div>

        {/* Title */}
        <h2 style={{
          margin:'0 0 14px',
          fontSize:22,
          fontWeight:800,
          color:C.text,
          textAlign:'center',
          letterSpacing:'-0.02em',
        }}>{current.title}</h2>

        {/* Body */}
        <div style={{ width:'100%', marginBottom:28, minHeight:80, display:'flex', alignItems:'center', justifyContent:'center' }}>
          {current.bodyNode
            ? current.bodyNode
            : <p style={{ fontSize:14, color:C.textSub, textAlign:'center', margin:0, lineHeight:1.75 }}>{current.body}</p>
          }
        </div>

        {/* Action button */}
        <button
          onClick={handleAction}
          style={{
            background:`linear-gradient(135deg, ${C.accent}, ${C.purple})`,
            color:'#fff',
            border:'none',
            borderRadius:12,
            padding:'13px 32px',
            fontSize:15,
            fontWeight:700,
            cursor:'pointer',
            fontFamily:'inherit',
            width:'100%',
            transition:'opacity 0.15s',
            boxShadow:`0 4px 20px ${C.accent}44`,
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.88' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
        >
          {current.action}
        </button>

        {/* Skip */}
        {!isLast && (
          <button
            onClick={() => {
              localStorage.setItem('surgimetrics_onboarded', 'true')
              onClose()
            }}
            style={{
              background:'transparent',
              border:'none',
              color:C.textDim,
              fontSize:12,
              cursor:'pointer',
              marginTop:14,
              fontFamily:'inherit',
            }}
          >
            Pular introdução
          </button>
        )}
      </div>
    </div>
  )
}

// ---- SyncStatus ----
// status: 'ok' | 'saving' | 'error'. Dá feedback real de salvamento ao usuário.
function SyncStatus({ status = 'ok', saveError, onRetry, lastSavedAt }) {
  const base = { display:'flex', alignItems:'center', gap:5, fontSize:11, fontWeight:600, userSelect:'none' }

  if (status === 'blocked') {
    return (
      <div style={{ ...base, color:C.red }} title="Suas alterações ainda não foram salvas — aguardando vincular sua clínica. Não feche a página.">
        <span style={{ fontSize:13 }}>⚠</span>
        Não salvo
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div style={{ ...base, color:C.yellow }}>
        <span title={saveError} style={{ cursor:'help', display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ fontSize:13 }}>⚠</span>
          Erro ao salvar
        </span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{ marginLeft:4, background:'none', border:`1px solid ${C.border}`, borderRadius:6,
              padding:'1px 7px', fontSize:10, fontWeight:700, color:C.text, cursor:'pointer', fontFamily:'inherit' }}
          >
            Repetir
          </button>
        )}
      </div>
    )
  }

  if (status === 'saving') {
    return (
      <div style={{ ...base, color:C.textSub }}>
        <span style={{ fontSize:10 }}>⟳</span>
        Salvando…
      </div>
    )
  }

  const hora = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }) : null
  return (
    <div style={{ ...base, color:C.green }}>
      <span style={{ fontSize:10 }}>●</span>
      {hora ? `Salvo ${hora}` : 'Sincronizado'}
    </div>
  )
}

// Placeholder "em breve" para áreas ainda sem features (Clínico, Automações).
function AreaComingSoon({ area }) {
  return (
    <Card style={{ padding:32, textAlign:'center' }}>
      <div style={{ fontSize:13, color:C.accentLight, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>Em breve</div>
      <div style={{ fontSize:20, fontWeight:800, color:C.text, marginBottom:10 }}>Área {area.label}</div>
      <div style={{ fontSize:14, color:C.textSub, maxWidth:520, margin:'0 auto', lineHeight:1.6 }}>{AREA_SOON_HINT[area.id] || 'Disponível em breve.'}</div>
    </Card>
  )
}

// ---- FinanceWorkspace ----
export function FinanceWorkspace() {
  const { page = 'dashboard' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { trialDaysLeft, billing } = useBilling()
  const { mode, toggleTheme } = useTheme()
  const { canAccess, clinicName, ownerId, role, loading: roleLoading } = useUserRole()
  const isLightMode = mode === 'light'
  const [data, setRaw] = useState(createEmptyData)
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState('')
  const [saveStatus, setSaveStatus] = useState('ok') // 'ok' | 'saving' | 'error' | 'blocked'
  const [lastSavedAt, setLastSavedAt] = useState(null) // horário da última confirmação no servidor
  const [loadError, setLoadError] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 1024 : false)
  const isNarrow = typeof window !== 'undefined' ? window.innerWidth < 380 : false
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem('surgimetrics_onboarded') !== 'true' : false
  )
  const hydratedRef = useRef(false)
  const saveTimerRef = useRef(null)
  const pendingRef = useRef(false)      // há edição aguardando persistência?
  const baselineRef = useRef(null)      // o que este cliente carregou/persistiu (base p/ deleção segura)
  const revisionRef = useRef(0)
  const immediateSnapshotRef = useRef(null)
  const enqueueSaveRef = useRef(createSerializedTaskQueue())
  const durablePendingRef = useRef(null)
  const latestRef = useRef({ data, ownerId })
  latestRef.current = { data, ownerId }

  // Persistência central: NUNCA salva sob escopo indefinido (sem ownerId). Atualiza o status
  // de salvamento para a UI dar feedback real (Salvando/Sincronizado/Erro).
  function flushSave(owner, snapshot, revision = revisionRef.current) {
    if (!owner) { setSaveStatus('blocked'); return Promise.reject(new Error('Clinica nao identificada para salvar os dados.')) }
    pendingRef.current = true
    setSaveStatus('saving')
    return enqueueSaveRef.current(async () => {
      try {
        await saveFinanceData(owner, snapshot, baselineRef.current)
        baselineRef.current = snapshot   // o que acabou de persistir vira o novo baseline
        if (durablePendingRef.current && revision >= durablePendingRef.current.revision) {
          clearPendingSave(user?.id, durablePendingRef.current.pendingId)
          durablePendingRef.current = null
        }
        setSaveError('')
        if (revision >= revisionRef.current) {
          setSaveStatus('ok')
          setLastSavedAt(new Date())
          pendingRef.current = false
        }
        return snapshot
      } catch (error) {
        setSaveError(error.message || 'Nao foi possivel sincronizar os dados.')
        setSaveStatus('error')
        throw error
      }
    })
  }
  const retrySave = () => {
    flushSave(latestRef.current.ownerId, latestRef.current.data, revisionRef.current).catch(() => {})
  }

  const safeData = useMemo(() => normalizeData(data || createEmptyData()), [data])
  const todayDate = today()
  const monthStartDate = startOfMonth(todayDate)
  const summary = useMemo(() => buildMetrics(safeData), [safeData])
  const summaryMonth = useMemo(
    () => buildMetrics(safeData, { startDate: monthStartDate, endDate: todayDate }),
    [safeData, monthStartDate, todayDate]
  )

  useEffect(() => {
    let active = true
    async function loadRemoteData() {
      setLoading(true)
      setLoadError('')
      hydratedRef.current = false
      const draftKey = user?.id ? getDraftStorageKey(user.id) : ''
      let draftData = null
      if (typeof window !== 'undefined' && draftKey) {
        const rawDraft = window.sessionStorage.getItem(draftKey)
        if (rawDraft) {
          try {
            draftData = normalizeData(JSON.parse(rawDraft))
            setRaw(draftData)
          } catch {
            window.sessionStorage.removeItem(draftKey)
          }
        }
      }
      try {
        const serverData = await importLegacyDataIfNeeded(user, ownerId || user.id)
        if (!active) return
        const pendingSave = readPendingSave(user.id)
        let nextData = serverData
        let baselineData = serverData
        let initialRevision = 0
        if (pendingSave?.ownerId === ownerId) {
          nextData = normalizeData(mergePendingFinanceSave(serverData, pendingSave))
          try {
            await saveFinanceData(ownerId, nextData, serverData)
            clearPendingSave(user.id, pendingSave.pendingId)
          } catch (error) {
            durablePendingRef.current = { ...pendingSave, revision:1 }
            pendingRef.current = true
            initialRevision = 1
            setSaveError(error.message || 'Nao foi possivel recuperar o lancamento pendente.')
            setSaveStatus('error')
          }
          if (!active) return
          if (!durablePendingRef.current) baselineData = nextData
        }
        // O servidor é a fonte de verdade. NUNCA deixar o rascunho (que pode estar vazio/defasado)
        // sobrescrever o dado carregado: era isso que fazia o autosave apagar lançamentos no banco
        // (rascunho sem a linha -> delete-sync remove a linha do servidor).
        setRaw(nextData)
        baselineRef.current = baselineData
        revisionRef.current = initialRevision
        hydratedRef.current = true
      } catch (error) {
        if (!active) return
        setLoadError(error.message || 'Nao foi possivel carregar os dados remotos.')
        // Carga falhou: mostra o rascunho apenas para visualização, mas NÃO habilita o autosave
        // (hydratedRef permanece false), para um estado vazio/parcial jamais ser persistido e
        // apagar o que está no banco.
        if (draftData) setRaw(draftData)
        hydratedRef.current = false
      } finally {
        if (active) setLoading(false)
      }
    }
    if (user?.id && ownerId) loadRemoteData()
    return () => { active = false }
    // Depende do id e do ownerId: ownerId vem do UserRoleContext e pode ser de outro usuario (membro de clinica)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, ownerId])

  // Autosave com DEBOUNCE + GUARDA DE ESCOPO.
  // - Guarda: só salva com ownerId resolvido. NUNCA cai pro fallback user.id (evita gravar no
  //   escopo errado para membros da clínica -> dado órfão).
  // - Debounce: coalesce várias edições em um único save (menos escritas, menos corrida).
  useEffect(() => {
    if (!user?.id || !hydratedRef.current) return
    if (immediateSnapshotRef.current === data) {
      immediateSnapshotRef.current = null
      return
    }
    // BLINDAGEM: escopo (ownerId) ainda não resolveu mas há edição não salva. Em vez de ignorar
    // em silêncio (o bug que sumia dados), avisa ALTO e mantém pendente. Quando o ownerId resolver,
    // este efeito re-roda (ownerId está nas deps) e grava de verdade.
    if (!ownerId) {
      if (pendingRef.current) setSaveStatus('blocked')
      return
    }
    pendingRef.current = true
    setSaveStatus('saving')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const snapshot = data
    const owner = ownerId
    const revision = revisionRef.current
    saveTimerRef.current = setTimeout(() => { flushSave(owner, snapshot, revision).catch(() => {}) }, 800)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, user?.id, ownerId])

  // Flush da última edição ao desmontar (navegar pra fora) — não perder o que estava no debounce.
  useEffect(() => () => {
    const { data: d, ownerId: o } = latestRef.current
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (o && pendingRef.current) flushSave(o, d, revisionRef.current).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const warnBeforeUnload = event => {
      if (!pendingRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!user?.id || !hydratedRef.current) return
    const draftKey = getDraftStorageKey(user.id)
    window.sessionStorage.setItem(draftKey, JSON.stringify(data))
  }, [data, user?.id])

  useEffect(() => {
    function onResize() {
      const nextMobile = window.innerWidth < 1024
      setIsMobile(nextMobile)
      if (!nextMobile) setMobileNavOpen(false)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    setMobileNavOpen(false)
  }, [page])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!PAGES[page]) return
    if (page === 'billing') return  // não persistir redirecionamentos forçados para billing
    window.sessionStorage.setItem(LAST_APP_PATH_KEY, location.pathname)
    window.localStorage.setItem(LAST_APP_PATH_KEY, location.pathname)
  }, [location.pathname, page])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const shouldLockScroll = isMobile && mobileNavOpen
    const previousOverflow = document.body.style.overflow
    const previousPosition = document.body.style.position
    const previousTop = document.body.style.top
    const previousLeft = document.body.style.left
    const previousRight = document.body.style.right
    const previousWidth = document.body.style.width
    const scrollY = window.scrollY
    if (shouldLockScroll) {
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollY}px`
      document.body.style.left = '0'
      document.body.style.right = '0'
      document.body.style.width = '100%'
    }
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.position = previousPosition
      document.body.style.top = previousTop
      document.body.style.left = previousLeft
      document.body.style.right = previousRight
      document.body.style.width = previousWidth
      if (shouldLockScroll) window.scrollTo(0, scrollY)
    }
  }, [isMobile, mobileNavOpen])

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      const meta = e.metaKey || e.ctrlKey

      // Cmd+K / Ctrl+K — toggle quick search
      if (meta && e.key === 'k') {
        e.preventDefault()
        setQuickSearchOpen(open => !open)
        return
      }

      // Cmd+N / Ctrl+N — new surgery or new consultation depending on page
      if (meta && e.key === 'n') {
        e.preventDefault()
        if (page === 'sales') {
          window.dispatchEvent(new CustomEvent('new-surgery'))
        } else if (page === 'consultations') {
          window.dispatchEvent(new CustomEvent('new-consultation'))
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [page])

  const applyDataUpdate = updater => {
    const current = latestRef.current.data
    const nextData = normalizeData(typeof updater === 'function' ? updater(current) : updater)
    const revision = revisionRef.current + 1
    revisionRef.current = revision
    latestRef.current = { data:nextData, ownerId }
    pendingRef.current = true
    setSaveStatus('saving')
    setRaw(nextData)
    return { data:nextData, revision }
  }
  const setData = updater => { applyDataUpdate(updater) }
  const saveDataNow = (updater, pendingOperation = null) => {
    const update = applyDataUpdate(updater)
    // BLINDAGEM: sem escopo resolvido, NÃO grava agora (grava rejeitaria em silêncio). Marca
    // "não salvo" e deixa o autosave assumir — ele grava assim que o ownerId resolver. Não marca
    // immediateSnapshotRef (senão o autosave pularia este data e nunca gravaria).
    if (!ownerId) { setSaveStatus('blocked'); return Promise.resolve(update.data) }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    immediateSnapshotRef.current = update.data
    if (pendingOperation?.collection && pendingOperation?.record?.id && user?.id) {
      const pendingSave = {
        ...pendingOperation,
        ownerId,
        pendingId:`${pendingOperation.collection}:${pendingOperation.record.id}:${Date.now()}`,
        createdAt:new Date().toISOString(),
        revision:update.revision,
      }
      durablePendingRef.current = pendingSave
      writePendingSave(user.id, pendingSave)
      clearFinanceModalDraft()
    }
    return flushSave(ownerId, update.data, update.revision)
  }
  const google = useGoogleCalendarSync({ data:safeData, enabled:!loading })
  const hasData = useMemo(() => safeData.procedures.length || safeData.surgeries.length || safeData.consultations.length || safeData.products.length || safeData.productSales.length || safeData.productPurchases.length || safeData.extraRevenues.length || safeData.expenses.length || safeData.assets.length || safeData.liabilities.length || safeData.goals.length, [safeData])

  // ---- Navegação por áreas (spec seção 4) ----
  function canAccessArea(area) {
    if (!area.roles.includes(role)) return false
    if (area.comingSoon) return true
    return area.sections.some(s => s.items.some(i => canAccess(i.id)))
  }
  const accessibleAreas = AREAS.filter(canAccessArea)
  const accessibleItems = accessibleAreas.flatMap(a => a.sections).flatMap(s => s.items).filter(item => canAccess(item.id))
  const comingSoonArea = COMING_SOON.find(a => a.id === page)
  const activeAreaId = comingSoonArea ? comingSoonArea.id : (areaIdForPage(page) || accessibleAreas[0]?.id)
  const activeArea = AREAS.find(a => a.id === activeAreaId)
  const fallbackPage = accessibleItems[0]?.id || 'dashboard'

  // Só decidir acesso/redirect depois que o role (UserRoleContext) carregou — senão o
  // primeiro render (role=null) redireciona pra dashboard em refresh/deep-link de qualquer página.
  if (!roleLoading) {
    if (comingSoonArea) {
      if (!canAccessArea(comingSoonArea)) return <Navigate to={`/app/${fallbackPage}`} replace />
    } else if (!PAGES[page] || !canAccess(page)) {
      return <Navigate to={`/app/${fallbackPage}`} replace />
    }
  }

  const Page = comingSoonArea ? (() => <AreaComingSoon area={comingSoonArea} />) : PAGES[page]
  const pageTitle = comingSoonArea ? comingSoonArea.label : TITLES[page]
  const pageSubtitle = comingSoonArea ? 'Área em construção — disponível em breve.' : SUBTITLES[page]
  const dateStr = new Date().toLocaleDateString('pt-BR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  const sidebarQuickStats = [
    `${summary.surgeriesCompleted} cirurgia(s)`,
    `${summary.consultationsCompleted} consulta(s)`,
    billing?.status === 'trialing' ? `Trial: ${trialDaysLeft} dia(s)` : `Assinatura: ${billing?.status || 'pendente'}`,
  ]
  // Sub-navegação = seções da área ativa, filtradas por permissão.
  const visibleSections = (activeArea?.sections ?? [])
    .map(section => ({ ...section, items: section.items.filter(item => canAccess(item.id)) }))
    .filter(section => section.items.length > 0)
  // Busca rápida varre todas as áreas acessíveis (não só a ativa).
  const searchSections = accessibleAreas
    .map(a => ({ items: a.sections.flatMap(s => s.items).filter(i => canAccess(i.id)) }))
    .filter(s => s.items.length > 0)
  const quickLinks = accessibleItems.slice(0, 4)
  const desktopCompactNav = !isMobile
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900
  const compactForShortHeight = desktopCompactNav && viewportHeight < 860
  const ultraCompactDesktop = desktopCompactNav && viewportHeight < 760
  const sidebarStats = isMobile
    ? sidebarQuickStats
    : sidebarQuickStats.slice(0, ultraCompactDesktop ? 0 : (compactForShortHeight ? 1 : 2))

  if (loading || roleLoading) {
    return (
      <div style={{ display:'flex', minHeight:'100vh', background:C.bg }}>
        {/* Sidebar skeleton */}
        <aside style={{ width:272, background:C.surface, borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', flexShrink:0 }}>
          <div style={{ padding:'24px 20px 18px', borderBottom:`1px solid ${C.border}` }}>
            <SkeletonBlock w={120} h={28} />
            <SkeletonBlock w={180} h={12} style={{ marginTop:8 }} />
          </div>
          <div style={{ padding:'16px 20px', borderBottom:`1px solid ${C.border}` }}>
            <SkeletonBlock w={100} h={10} style={{ marginBottom:8 }} />
            <SkeletonBlock w={160} h={18} style={{ marginBottom:6 }} />
            <SkeletonBlock w={140} h={12} />
          </div>
          <div style={{ padding:'16px 20px', flex:1 }}>
            {[1,2,3,4,5,6].map(i => (
              <div key={i} style={{ display:'flex', gap:12, alignItems:'center', padding:'10px 0' }}>
                <SkeletonBlock w={20} h={20} radius={6} />
                <div style={{ flex:1 }}>
                  <SkeletonBlock w="80%" h={13} style={{ marginBottom:5 }} />
                  <SkeletonBlock w="60%" h={10} />
                </div>
              </div>
            ))}
          </div>
        </aside>
        {/* Main skeleton */}
        <main style={{ flex:1, padding:'28px 28px 64px' }}>
          <SkeletonBlock w={280} h={34} style={{ marginBottom:8 }} />
          <SkeletonBlock w={200} h={14} style={{ marginBottom:32 }} />
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:16, marginBottom:24 }}>
            {[1,2,3,4,5,6].map(i => (
              <div key={i} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:20 }}>
                <SkeletonBlock w="60%" h={11} style={{ marginBottom:12 }} />
                <SkeletonBlock w="80%" h={28} style={{ marginBottom:8 }} />
                <SkeletonBlock w="50%" h={12} />
              </div>
            ))}
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1.25fr 1fr', gap:16 }}>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:24 }}>
              <SkeletonBlock w={160} h={13} style={{ marginBottom:20 }} />
              <div style={{ display:'flex', gap:8, alignItems:'flex-end', height:140 }}>
                {[1,2,3,4,5,6].map(i => (
                  <div key={i} style={{ flex:1, display:'flex', gap:3, alignItems:'flex-end', height:140 }}>
                    <SkeletonBlock w={16} h={`${40+i*12}px`} radius={3} />
                    <SkeletonBlock w={16} h={`${20+i*10}px`} radius={3} />
                  </div>
                ))}
              </div>
            </div>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:24 }}>
              <SkeletonBlock w={160} h={13} style={{ marginBottom:20 }} />
              {[1,2,3].map(i => (
                <div key={i} style={{ marginBottom:18 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                    <SkeletonBlock w={100} h={13} />
                    <SkeletonBlock w={60} h={13} />
                  </div>
                  <SkeletonBlock w="100%" h={8} radius={99} />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100vh', height:isMobile ? 'auto' : '100dvh', background:C.bg }}>
      {isMobile && mobileNavOpen && <div onClick={() => setMobileNavOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.56)', zIndex:30 }} />}

      {/* Barra de áreas (topo, full-width) */}
      <nav data-testid="area-bar" style={{ display:'flex', alignItems:'center', gap:4, padding:isMobile ? '8px 12px' : '8px 16px', borderBottom:`1px solid ${C.border}`, background:C.surface, overflowX:'auto', flexShrink:0, zIndex:isMobile ? 20 : 11 }}>
        {accessibleAreas.map(area => {
          const active = area.id === activeAreaId
          return (
            <button
              key={area.id}
              onClick={() => {
                if (area.comingSoon) { navigate(`/app/${area.id}`); if (isMobile) setMobileNavOpen(false); return }
                const first = area.sections.flatMap(s => s.items).find(i => canAccess(i.id))
                if (first) navigate(`/app/${first.id}`)
                if (isMobile) setMobileNavOpen(false)
              }}
              style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 12px', borderRadius:10, border:active ? `1px solid ${C.accent}44` : '1px solid transparent', background:active ? C.accent+'16' : 'transparent', color:active ? C.text : C.textSub, fontWeight:active ? 700 : 600, fontSize:13, cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap', flexShrink:0 }}
            >
              <NavIcon name={area.icon} size={15} />
              <span>{area.label}</span>
              {area.comingSoon && <span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:C.textDim, border:`1px solid ${C.border}`, borderRadius:6, padding:'1px 5px' }}>em breve</span>}
            </button>
          )
        })}
      </nav>

      {/* Linha: sidebar (sub-nav da área ativa) + conteúdo */}
      <div style={{ display:'flex', flex:1, minHeight:0 }}>
      <aside style={{ width:isMobile ? 272 : 250, background:C.surface, borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', position:isMobile ? 'fixed' : 'relative', left:isMobile ? 0 : 'auto', top:0, height:isMobile ? '100dvh' : '100%', overflow:'hidden', flexShrink:0, zIndex:isMobile ? 40 : 10, transform:isMobile ? (mobileNavOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none', transition:'transform 0.25s ease', touchAction:isMobile ? 'pan-y' : 'auto', overscrollBehavior:'contain' }}>
        <div style={{ padding:isMobile ? '24px 20px 18px' : (ultraCompactDesktop ? '10px 12px 8px' : '16px 14px 12px'), borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <BrandLogo size="sm" />
            {!ultraCompactDesktop && <div style={{ fontSize:isMobile ? 11 : 10, color:C.textDim, marginTop:4 }}>ERP financeiro para cirurgia plástica</div>}
          </div>
          {isMobile && <button onClick={() => setMobileNavOpen(false)} style={getIconButton()}>✕</button>}
        </div>

        <div style={{ padding:isMobile ? '16px 20px' : (ultraCompactDesktop ? '7px 12px' : '10px 14px'), borderBottom:`1px solid ${C.border}`, background:C.accent+'08' }}>
          <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Conta ativa</div>
          <div style={{ fontSize:isMobile ? 14 : 13, fontWeight:700, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user.user_metadata?.name || user.email}</div>
          {clinicName && <div style={{ fontSize:11, color:C.textDim, marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{clinicName}</div>}
          {isMobile && <div style={{ fontSize:10, color:C.textDim, marginTop:1 }}>{user.email}</div>}
        </div>

        {canAccess('finance') && <div style={{ padding:isMobile ? '16px 20px' : (ultraCompactDesktop ? '7px 12px' : '9px 14px'), borderBottom:`1px solid ${C.border}`, background:`linear-gradient(180deg, transparent, ${C.accent}0F)` }}>
          <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>Resumo rápido</div>
          <div style={{ display:'flex', flexDirection:'column', gap:ultraCompactDesktop ? 2 : 4 }}>
            <div>
              <div style={{ fontSize:9, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:1 }}>Caixa hoje</div>
              <div style={{ fontSize:isMobile ? 20 : (ultraCompactDesktop ? 14 : 16), fontWeight:900, color:C.accent, lineHeight:1.1 }}>{fmt(summary.cashBalance)}</div>
            </div>
            {!ultraCompactDesktop && (
              <div>
                <div style={{ fontSize:9, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:1 }}>Lucro líq. mês</div>
                <div style={{ fontSize:isMobile ? 14 : 12, fontWeight:700, color:summaryMonth.netProfit >= 0 ? C.green : C.red, lineHeight:1.1 }}>{fmt(summaryMonth.netProfit)}</div>
              </div>
            )}
          </div>
          {!ultraCompactDesktop && sidebarStats.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:isMobile ? 4 : 2, marginTop:isMobile ? 6 : 4 }}>
              {sidebarStats.map(item => <div key={item} style={{ color:C.textDim, fontSize:isMobile ? 12 : 11 }}>{item}</div>)}
            </div>
          )}
        </div>}

        <div data-testid="sub-nav" style={{ flex:1, overflowY:isMobile ? 'scroll' : (compactForShortHeight ? 'auto' : 'hidden'), padding:isMobile ? '14px 10px 18px' : (ultraCompactDesktop ? '6px' : '8px 8px 10px'), WebkitOverflowScrolling:'touch', overscrollBehavior:'contain', touchAction:'pan-y' }}>
          {visibleSections.map(section => (
            <div key={section.title} style={{ marginBottom:isMobile ? 14 : (ultraCompactDesktop ? 6 : 8) }}>
              <div style={{ padding:isMobile ? '0 10px 8px' : (ultraCompactDesktop ? '0 6px 4px' : '0 8px 6px'), fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.12em', fontWeight:700 }}>{section.title}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:isMobile ? 4 : (ultraCompactDesktop ? 2 : 3) }}>
                {section.items.map(item => {
                  const active = item.id === page || (item.id === 'finance' && FINANCE_ALIASES.has(page))
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigate(`/app/${item.id}`)}
                      style={{
                        display:'grid',
                        gridTemplateColumns:isMobile ? '20px 1fr' : '16px 1fr',
                        gap:isMobile ? 12 : (ultraCompactDesktop ? 7 : 9),
                        alignItems:'start',
                        padding:isMobile ? '12px 14px' : (ultraCompactDesktop ? '6px 8px' : '8px 10px'),
                        borderRadius:isMobile ? 12 : 10,
                        cursor:'pointer',
                        fontFamily:'inherit',
                        background:active ? C.accent+'16' : 'transparent',
                        color:active ? C.text : C.textSub,
                        fontSize:isMobile ? 14 : (ultraCompactDesktop ? 12 : 13),
                        width:'100%',
                        textAlign:'left',
                        border:active ? `1px solid ${C.accent}40` : '1px solid transparent',
                      }}
                    >
                      <span style={{ display:'flex', alignItems:'center', justifyContent:'center', opacity:active ? 1 : 0.5, marginTop:1 }}>
                        <NavIcon name={item.icon} size={isMobile ? 16 : (ultraCompactDesktop ? 13 : 15)} />
                      </span>
                      <span>
                        <span style={{ display:'block', fontWeight:active ? 700 : 600 }}>{item.label}</span>
                        {isMobile && <span style={{ display:'block', color:active ? C.textSub : C.textDim, fontSize:11, marginTop:3 }}>{item.hint}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding:isMobile ? '12px 10px 14px' : (ultraCompactDesktop ? '6px' : '8px'), borderTop:`1px solid ${C.border}` }}>
          <button onClick={signOut} style={{ width:'100%', padding:isMobile ? '10px 14px' : (ultraCompactDesktop ? '6px 9px' : '8px 10px'), borderRadius:10, border:`1px solid ${C.border}`, background:'transparent', color:C.textDim, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>Sair da conta</button>
        </div>
      </aside>

      <main style={{ flex:1, overflowY:isMobile && mobileNavOpen ? 'hidden' : 'auto', pointerEvents:isMobile && mobileNavOpen ? 'none' : 'auto', padding:isMobile ? '20px 16px 56px' : '20px 22px 34px' }}>
        {(saveStatus === 'blocked' || saveStatus === 'error') && (
          <div role="alert" style={{ marginBottom:16, borderRadius:12, padding:'12px 16px', background:`${C.red}1a`, border:`1px solid ${C.red}`, color:C.red, display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <span style={{ fontSize:18 }}>⚠️</span>
            <div style={{ flex:1, minWidth:200, fontSize:13, fontWeight:600, lineHeight:1.5 }}>
              {saveStatus === 'blocked'
                ? <>Suas alterações <b>ainda não foram salvas</b> — estamos vinculando sua clínica à sessão. <b>Não feche esta página.</b> Elas serão gravadas automaticamente assim que resolver.</>
                : <>Falha ao salvar no servidor. Suas alterações continuam na tela, mas <b>não foram confirmadas no banco</b>.{saveError ? ` Detalhe: ${saveError}` : ''}</>}
            </div>
            {saveStatus === 'error' && (
              <button type="button" onClick={retrySave} style={{ background:C.red, border:'none', borderRadius:8, padding:'7px 14px', fontSize:12, fontWeight:700, color:'#fff', cursor:'pointer', fontFamily:'inherit' }}>Tentar de novo</button>
            )}
          </div>
        )}
        <div style={{ marginBottom:22 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
              {isMobile && <button onClick={() => setMobileNavOpen(true)} style={getIconButton()}>☰</button>}
              <div>
                <div style={{ display:'flex', flexDirection:isMobile ? 'column' : 'row', alignItems:isMobile ? 'flex-start' : 'center', gap:8, marginBottom:2 }}>
                  <h1 style={{ margin:0, fontSize:isMobile ? 24 : 28, fontWeight:900, letterSpacing:'-0.03em', color:C.text }}>{pageTitle}</h1>
                  <SyncStatus status={saveStatus} saveError={saveError} onRetry={retrySave} lastSavedAt={lastSavedAt} />
                </div>
                <div style={{ fontSize:13, color:C.textDim, marginTop:4, textTransform:'capitalize' }}>{dateStr}</div>
                <div style={{ fontSize:isMobile ? 13 : 14, color:C.textSub, marginTop:10, maxWidth:620, lineHeight:isMobile ? 1.55 : 1.5 }}>{pageSubtitle}</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              <AlertsBell data={safeData} summary={summary} onNavigate={id => navigate(`/app/${id}`)} />
              <CrmBell onNavigate={id => navigate(`/app/${id}`)} />
              <button
                onClick={toggleTheme}
                title={isLightMode ? 'Ativar modo escuro' : 'Ativar modo claro'}
                aria-label={isLightMode ? 'Ativar modo escuro' : 'Ativar modo claro'}
                aria-pressed={isLightMode}
                style={{
                  ...getChipButton(),
                  width:34,
                  height:34,
                  padding:0,
                  borderRadius:999,
                  border:`1px solid ${isLightMode ? C.accent : C.border}`,
                  background:isLightMode ? `${C.accent}1F` : 'transparent',
                  color:isLightMode ? C.accent : C.textSub,
                  display:'grid',
                  placeItems:'center',
                  fontSize:15,
                }}
              >
                {isLightMode ? '☾' : '☀'}
              </button>
              {/* Quick search chip */}
              <button
                onClick={() => setQuickSearchOpen(true)}
                title="Busca rápida (Cmd+K)"
                style={{
                  ...getChipButton(),
                  border:`1px solid ${C.border}`,
                  display:'flex',
                  alignItems:'center',
                  gap:6,
                  color:C.textDim,
                  fontSize:12,
                }}
              >
                <span style={{ fontSize:13 }}>⌕</span>
                <span>Busca</span>
                {!isMobile && <kbd style={getKbdSmall()}>⌘K</kbd>}
              </button>
              {!isMobile && quickLinks.map(item => {
                const active = item.id === page
                return <button key={item.id} onClick={() => navigate(`/app/${item.id}`)} style={{ ...getChipButton(), border:active ? `1px solid ${C.accent}44` : `1px solid ${C.border}`, background:active ? C.accent+'14' : 'transparent', color:active ? C.accentLight : C.textSub }}>{item.label}</button>
              })}
            </div>
          </div>
        </div>

        {isMobile && (
          <Card style={{ marginBottom:16, padding:14 }}>
            <div style={{ fontSize:11, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10, fontWeight:700 }}>
              Acesso rapido
            </div>
            <div style={{ display:'grid', gridTemplateColumns:isNarrow ? '1fr' : '1fr 1fr', gap:8 }}>
              {quickLinks.map(item => {
                const active = item.id === page
                return (
                  <button
                    key={item.id}
                    onClick={() => navigate(`/app/${item.id}`)}
                    style={{
                      ...getChipButton(),
                      border:active ? `1px solid ${C.accent}44` : `1px solid ${C.border}`,
                      background:active ? C.accent+'14' : 'transparent',
                      color:active ? C.accentLight : C.textSub,
                      borderRadius:12,
                      padding:'10px 12px',
                      textAlign:'left',
                    }}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </Card>
        )}

        {loadError && <Card style={{ marginBottom:16, border:`1px solid ${C.red}33` }}><div style={{ color:C.red, fontSize:13 }}>{loadError}</div></Card>}
        {!hasData && <Card style={{ marginBottom:20, border:`1px solid ${C.accent}33`, background:`linear-gradient(135deg, ${C.surface}, ${C.card})` }}><div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', alignItems:'center' }}><div><div style={{ fontSize:12, color:C.accentLight, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>ERP vazio</div><div style={{ fontSize:18, fontWeight:700, color:C.text }}>Comece a operação sem digitação duplicada.</div><div style={{ fontSize:13, color:C.textSub, marginTop:6, lineHeight:1.55 }}>Cadastre procedimentos, cirurgias, consultas, produtos e despesas. O resto alimenta fluxo, DRE, balanço, metas e dashboard automaticamente.</div></div><div style={{ fontSize:12, color:C.textDim, lineHeight:1.7, width:isMobile ? '100%' : 'auto' }}>Primeiro passo recomendado:<div>1. Procedimentos</div><div>2. Cirurgias, consultas e produtos</div><div>3. Despesas e metas</div></div></div></Card>}
        <Page data={safeData} setData={setData} saveDataNow={saveDataNow} saveError={saveError} google={google} />
        <CopilotWidget data={safeData} />
        <FAB currentPage={page} />
      </main>
      </div>

      {/* Quick search modal */}
      <QuickSearchModal
        open={quickSearchOpen}
        onClose={() => setQuickSearchOpen(false)}
        navigate={navigate}
        sections={searchSections}
      />

      {/* Onboarding wizard */}
      {showOnboarding && !loading && !hasData && (
        <OnboardingWizard onClose={() => setShowOnboarding(false)} />
      )}
    </div>
  )
}

function getIconButton() {
  return {
    width:38,
    height:38,
    borderRadius:10,
    border:`1px solid ${C.border}`,
    background:'transparent',
    color:C.textSub,
    cursor:'pointer',
    fontSize:16,
    fontFamily:'inherit',
    flexShrink:0,
  }
}

function getChipButton() {
  return {
    padding:'8px 12px',
    borderRadius:999,
    background:'transparent',
    color:C.textSub,
    fontSize:12,
    cursor:'pointer',
    fontFamily:'inherit',
  }
}

function getKbdSmall() {
  return {
    background:C.border,
    color:C.textDim,
    borderRadius:4,
    padding:'1px 5px',
    fontSize:10,
    fontFamily:'inherit',
    letterSpacing:'0.02em',
  }
}
