import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { C } from '../theme.js'
import { fmt } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, SkeletonBlock } from '../components/UI.jsx'
import { Dashboard } from '../components/Dashboard.jsx'
import { Sales } from '../components/Sales.jsx'
import { Plans } from '../components/Plans.jsx'
import { Products } from '../components/Products.jsx'
import { Finance } from '../components/Finance.jsx'
import { Goals } from '../components/Goals.jsx'
import { AIAssistant } from '../components/AIAssistant.jsx'
import { Consultations } from '../components/Consultations.jsx'
import { Reports } from '../components/Reports.jsx'
import { Settings } from '../components/Settings.jsx'
import { CopilotWidget } from '../components/CopilotWidget.jsx'
import { FAB } from '../components/FAB.jsx'
import { BrandLogo } from '../components/BrandLogo.jsx'
import { BillingPage } from './BillingPage.jsx'
import { Calendar } from '../components/Calendar.jsx'
import { TaxCalculator } from '../components/TaxCalculator.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useBilling } from '../context/BillingContext.jsx'
import { createEmptyData, normalizeData } from '../dataModel.js'
import { importLegacyDataIfNeeded, saveFinanceData } from '../lib/financeStore.js'

const NAV_SECTIONS = [
  {
    title:'Operação',
    items:[
      { id:'dashboard', label:'Dashboard', icon:'⬡', hint:'Visão geral da clínica' },
      { id:'plans', label:'Procedimentos', icon:'◇', hint:'Catálogo cirúrgico' },
      { id:'sales', label:'Cirurgias', icon:'◈', hint:'Agenda e resultados' },
      { id:'consultations', label:'Consultas', icon:'◎', hint:'Atendimentos e convênios' },
      { id:'calendar', label:'Agenda', icon:'◷', hint:'Calendário de cirurgias e consultas' },
      { id:'products', label:'Produtos', icon:'▣', hint:'Modeladores e estoque' },
    ],
  },
  {
    title:'Gestão',
    items:[
      { id:'finance', label:'Financeiro', icon:'◆', hint:'Caixa, DRE e balanço' },
      { id:'impostos', label:'Impostos', icon:'◐', hint:'Carnê-Leão, IRPF e DAS' },
      { id:'goals', label:'Metas', icon:'◉', hint:'Objetivos e acompanhamento' },
      { id:'reports', label:'Relatórios', icon:'◫', hint:'Análises e comparativos' },
      { id:'ai', label:'Assistente', icon:'✦', hint:'Perguntas sobre os dados' },
      { id:'billing', label:'Assinatura', icon:'◌', hint:'Trial, checkout e cobrança' },
      { id:'settings', label:'Configurações', icon:'⚙', hint:'Tema e preferências' },
    ],
  },
]

const TITLES = {
  dashboard:'Dashboard Executivo',
  plans:'Procedimentos',
  sales:'Cirurgias',
  consultations:'Consultas',
  calendar:'Agenda',
  products:'Modeladores e Produtos Pós-Operatórios',
  finance:'Financeiro',
  impostos:'Impostos & Tributos',
  cashflow:'Fluxo de Caixa',
  dre:'DRE',
  balance:'Balanço Patrimonial',
  goals:'Metas',
  reports:'Relatórios Analíticos',
  ai:'Central de IA',
  billing:'Assinatura',
  settings:'Configurações',
  'Agenda':'Agenda da Clínica',
}

const SUBTITLES = {
  dashboard:'Indicadores-chave e leitura rápida da operação.',
  plans:'Organize o portfólio de procedimentos da clínica.',
  sales:'Cadastre cirurgias e acompanhe margem por operação.',
  consultations:'Controle consultas, convênios e recebimentos.',
  calendar:'Visualize cirurgias e consultas no calendário.',
  products:'Gerencie modeladores, compras, vendas e estoque.',
  finance:'Centralize entradas, saídas, contas, DRE e balanço.',
  impostos:'Calcule Carnê-Leão, IRPF e tributos baseados nas suas receitas.',
  cashflow:'Movimentações realizadas e saldo por período.',
  dre:'Resultado do período por competência.',
  balance:'Ativos, passivos e patrimônio da clínica.',
  goals:'Metas financeiras com progresso automático.',
  reports:'Relatórios analíticos para apoiar decisões.',
  ai:'Previsões, diagnósticos e recomendações em tópicos.',
  billing:'Gerencie trial, plano e status da cobrança.',
  settings:'Ajuste visualização e preferências da plataforma.',
}

const PAGES = {
  dashboard:Dashboard,
  plans:Plans,
  sales:Sales,
  consultations:Consultations,
  calendar:Calendar,
  products:Products,
  finance:props => <Finance {...props} defaultTab="entradas" />,
  impostos:props => <TaxCalculator {...props} />,
  cashflow:props => <Finance {...props} defaultTab="fluxo" />,
  dre:props => <Finance {...props} defaultTab="dre" />,
  balance:props => <Finance {...props} defaultTab="balanco" />,
  goals:Goals,
  reports:Reports,
  ai:AIAssistant,
  billing:BillingPage,
  settings:Settings,
}

const FINANCE_ALIASES = new Set(['cashflow', 'dre', 'balance'])

// ---- QuickSearchModal ----
function QuickSearchModal({ open, onClose, navigate }) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)

  const allItems = useMemo(() => NAV_SECTIONS.flatMap(s => s.items), [])

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
          <kbd style={kbdSmall}>Esc</kbd>
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
              <span style={{ fontSize:16, opacity:0.7 }}>{item.icon}</span>
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
          <span><kbd style={kbdSmall}>↑↓</kbd> navegar</span>
          <span><kbd style={kbdSmall}>↵</kbd> selecionar</span>
          <span><kbd style={kbdSmall}>Esc</kbd> fechar</span>
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
function SyncStatus({ saveError }) {
  if (saveError) {
    return (
      <div
        title={saveError}
        style={{
          display:'flex',
          alignItems:'center',
          gap:5,
          fontSize:11,
          fontWeight:600,
          color:C.yellow,
          cursor:'help',
          userSelect:'none',
        }}
      >
        <span style={{ fontSize:13 }}>⚠</span>
        Erro ao salvar
      </div>
    )
  }
  return (
    <div style={{
      display:'flex',
      alignItems:'center',
      gap:5,
      fontSize:11,
      fontWeight:600,
      color:C.green,
      userSelect:'none',
    }}>
      <span style={{ fontSize:10 }}>●</span>
      Sincronizado
    </div>
  )
}

// ---- FinanceWorkspace ----
export function FinanceWorkspace() {
  const { page = 'dashboard' } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const { trialDaysLeft, billing } = useBilling()
  const [data, setRaw] = useState(createEmptyData)
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 1024 : false)
  const isNarrow = typeof window !== 'undefined' ? window.innerWidth < 380 : false
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(() =>
    typeof window !== 'undefined' ? window.localStorage.getItem('surgimetrics_onboarded') !== 'true' : false
  )
  const hydratedRef = useRef(false)
  const summary = useMemo(() => buildMetrics(data), [data])

  useEffect(() => {
    let active = true
    async function loadRemoteData() {
      setLoading(true)
      setLoadError('')
      hydratedRef.current = false
      try {
        const nextData = await importLegacyDataIfNeeded(user)
        if (!active) return
        setRaw(nextData)
        hydratedRef.current = true
      } catch (error) {
        if (!active) return
        setLoadError(error.message || 'Nao foi possivel carregar os dados remotos.')
        setRaw(createEmptyData())
      } finally {
        if (active) setLoading(false)
      }
    }
    if (user?.id) loadRemoteData()
    return () => { active = false }
  }, [user])

  useEffect(() => {
    if (!user?.id || !hydratedRef.current) return
    let active = true
    async function persist() {
      try {
        setSaveError('')
        await saveFinanceData(user.id, data)
      } catch (error) {
        if (active) setSaveError(error.message || 'Nao foi possivel sincronizar os dados.')
      }
    }
    persist()
    return () => { active = false }
  }, [data, user])

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

  const setData = updater => setRaw(prev => normalizeData(typeof updater === 'function' ? updater(prev) : updater))
  const hasData = useMemo(() => data.procedures.length || data.surgeries.length || data.consultations.length || data.products.length || data.productSales.length || data.productPurchases.length || data.extraRevenues.length || data.expenses.length || data.assets.length || data.liabilities.length || data.goals.length, [data])

  if (!PAGES[page]) return <Navigate to="/app/dashboard" replace />

  const Page = PAGES[page]
  const dateStr = new Date().toLocaleDateString('pt-BR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  const sidebarQuickStats = [
    `Caixa ${fmt(summary.cashBalance)}`,
    `${summary.surgeriesCompleted} cirurgia(s)`,
    `${summary.consultationsCompleted} consulta(s)`,
    billing?.status === 'trialing' ? `Trial: ${trialDaysLeft} dia(s)` : `Assinatura: ${billing?.status || 'pendente'}`,
  ]
  const quickLinks = NAV_SECTIONS.flatMap(section => section.items).slice(0, 4)
  const desktopCompactNav = !isMobile
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900
  const compactForShortHeight = desktopCompactNav && viewportHeight < 860
  const ultraCompactDesktop = desktopCompactNav && viewportHeight < 760
  const sidebarStats = isMobile
    ? sidebarQuickStats
    : sidebarQuickStats.slice(0, ultraCompactDesktop ? 0 : (compactForShortHeight ? 1 : 2))

  if (loading) {
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
    <div style={{ display:'flex', minHeight:'100vh', height:isMobile ? 'auto' : '100dvh', background:C.bg }}>
      {isMobile && mobileNavOpen && <div onClick={() => setMobileNavOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.56)', zIndex:30 }} />}

      <aside style={{ width:isMobile ? 272 : 250, background:C.surface, borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', position:isMobile ? 'fixed' : 'sticky', left:isMobile ? 0 : 'auto', top:0, height:'100dvh', overflow:'hidden', flexShrink:0, zIndex:isMobile ? 40 : 10, transform:isMobile ? (mobileNavOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none', transition:'transform 0.25s ease', touchAction:isMobile ? 'pan-y' : 'auto', overscrollBehavior:'contain' }}>
        <div style={{ padding:isMobile ? '24px 20px 18px' : (ultraCompactDesktop ? '10px 12px 8px' : '16px 14px 12px'), borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <BrandLogo size="sm" />
            {!ultraCompactDesktop && <div style={{ fontSize:isMobile ? 11 : 10, color:C.textDim, marginTop:4 }}>ERP financeiro para cirurgia plástica</div>}
          </div>
          {isMobile && <button onClick={() => setMobileNavOpen(false)} style={iconButton}>✕</button>}
        </div>

        <div style={{ padding:isMobile ? '16px 20px' : (ultraCompactDesktop ? '7px 12px' : '10px 14px'), borderBottom:`1px solid ${C.border}`, background:C.accent+'08' }}>
          <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Conta ativa</div>
          <div style={{ fontSize:isMobile ? 14 : 13, fontWeight:700, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user.user_metadata?.name || user.email}</div>
          {isMobile && <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>{user.email}</div>}
        </div>

        <div style={{ padding:isMobile ? '16px 20px' : (ultraCompactDesktop ? '7px 12px' : '9px 14px'), borderBottom:`1px solid ${C.border}`, background:`linear-gradient(180deg, transparent, ${C.accent}0F)` }}>
          <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>Resumo rápido</div>
          <div style={{ fontSize:isMobile ? 24 : (ultraCompactDesktop ? 16 : 18), fontWeight:900, color:C.accent, marginBottom:isMobile ? 8 : (ultraCompactDesktop ? 0 : 6) }}>{fmt(summary.cashBalance)}</div>
          {!ultraCompactDesktop && (
            <div style={{ display:'flex', flexDirection:'column', gap:isMobile ? 4 : 2 }}>
              {sidebarStats.map(item => <div key={item} style={{ color:C.textDim, fontSize:isMobile ? 12 : 11 }}>{item}</div>)}
            </div>
          )}
        </div>

        <div style={{ flex:1, overflowY:isMobile ? 'scroll' : (compactForShortHeight ? 'auto' : 'hidden'), padding:isMobile ? '14px 10px 18px' : (ultraCompactDesktop ? '6px' : '8px 8px 10px'), WebkitOverflowScrolling:'touch', overscrollBehavior:'contain', touchAction:'pan-y' }}>
          {NAV_SECTIONS.map(section => (
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
                      <span style={{ fontSize:isMobile ? 16 : (ultraCompactDesktop ? 12 : 13), opacity:active ? 1 : 0.5, lineHeight:1.2 }}>{item.icon}</span>
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
        <div style={{ marginBottom:22 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
              {isMobile && <button onClick={() => setMobileNavOpen(true)} style={iconButton}>☰</button>}
              <div>
                <div style={{ display:'flex', flexDirection:isMobile ? 'column' : 'row', alignItems:isMobile ? 'flex-start' : 'center', gap:8, marginBottom:2 }}>
                  <h1 style={{ margin:0, fontSize:isMobile ? 24 : 28, fontWeight:900, letterSpacing:'-0.03em', color:C.text }}>{TITLES[page]}</h1>
                  <SyncStatus saveError={saveError} />
                </div>
                <div style={{ fontSize:13, color:C.textDim, marginTop:4, textTransform:'capitalize' }}>{dateStr}</div>
                <div style={{ fontSize:isMobile ? 13 : 14, color:C.textSub, marginTop:10, maxWidth:620, lineHeight:isMobile ? 1.55 : 1.5 }}>{SUBTITLES[page]}</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
              {/* Quick search chip */}
              <button
                onClick={() => setQuickSearchOpen(true)}
                title="Busca rápida (Cmd+K)"
                style={{
                  ...chipButton,
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
                {!isMobile && <kbd style={kbdSmall}>⌘K</kbd>}
              </button>
              {!isMobile && quickLinks.map(item => {
                const active = item.id === page
                return <button key={item.id} onClick={() => navigate(`/app/${item.id}`)} style={{ ...chipButton, border:active ? `1px solid ${C.accent}44` : `1px solid ${C.border}`, background:active ? C.accent+'14' : 'transparent', color:active ? C.accentLight : C.textSub }}>{item.label}</button>
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
                      ...chipButton,
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
        {saveError && (
          <Card style={{ marginBottom:16, border:`1px solid ${C.yellow}33` }}>
            <div style={{ color:C.yellow, fontSize:13, lineHeight:1.7 }}>
              <div>Falha ao sincronizar com o backend. As alterações continuam na tela, mas não foram confirmadas no Supabase.</div>
              <div style={{ marginTop:6, color:C.textDim }}>Detalhe: {saveError}</div>
            </div>
          </Card>
        )}
        {!hasData && <Card style={{ marginBottom:20, border:`1px solid ${C.accent}33`, background:`linear-gradient(135deg, ${C.surface}, ${C.card})` }}><div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', alignItems:'center' }}><div><div style={{ fontSize:12, color:C.accentLight, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>ERP vazio</div><div style={{ fontSize:18, fontWeight:700, color:C.text }}>Comece a operação sem digitação duplicada.</div><div style={{ fontSize:13, color:C.textSub, marginTop:6, lineHeight:1.55 }}>Cadastre procedimentos, cirurgias, consultas, produtos e despesas. O resto alimenta fluxo, DRE, balanço, metas e dashboard automaticamente.</div></div><div style={{ fontSize:12, color:C.textDim, lineHeight:1.7, width:isMobile ? '100%' : 'auto' }}>Primeiro passo recomendado:<div>1. Procedimentos</div><div>2. Cirurgias, consultas e produtos</div><div>3. Despesas e metas</div></div></div></Card>}
        <Page data={data} setData={setData} saveError={saveError} />
        <CopilotWidget data={data} />
        <FAB currentPage={page} />
      </main>

      {/* Quick search modal */}
      <QuickSearchModal
        open={quickSearchOpen}
        onClose={() => setQuickSearchOpen(false)}
        navigate={navigate}
      />

      {/* Onboarding wizard */}
      {showOnboarding && !loading && !hasData && (
        <OnboardingWizard onClose={() => setShowOnboarding(false)} />
      )}
    </div>
  )
}

const iconButton = {
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

const chipButton = {
  padding:'8px 12px',
  borderRadius:999,
  background:'transparent',
  color:C.textSub,
  fontSize:12,
  cursor:'pointer',
  fontFamily:'inherit',
}

const kbdSmall = {
  background:C.border,
  color:C.textDim,
  borderRadius:4,
  padding:'1px 5px',
  fontSize:10,
  fontFamily:'inherit',
  letterSpacing:'0.02em',
}
