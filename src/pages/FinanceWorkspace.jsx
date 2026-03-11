import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { C } from '../theme.js'
import { fmt } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card } from '../components/UI.jsx'
import { Dashboard } from '../components/Dashboard.jsx'
import { Sales } from '../components/Sales.jsx'
import { Plans } from '../components/Plans.jsx'
import { Products } from '../components/Products.jsx'
import { Finance } from '../components/Finance.jsx'
import { Goals } from '../components/Goals.jsx'
import { AIAssistant } from '../components/AIAssistant.jsx'
import { Consultations } from '../components/Consultations.jsx'
import { Reports } from '../components/Reports.jsx'
import { useAuth } from '../context/AuthContext.jsx'
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
      { id:'products', label:'Produtos', icon:'▣', hint:'Modeladores e estoque' },
    ],
  },
  {
    title:'Gestão',
    items:[
      { id:'finance', label:'Financeiro', icon:'◆', hint:'Caixa, DRE e balanço' },
      { id:'goals', label:'Metas', icon:'◉', hint:'Objetivos e acompanhamento' },
      { id:'reports', label:'Relatórios', icon:'◫', hint:'Análises e comparativos' },
      { id:'ai', label:'Assistente', icon:'✦', hint:'Perguntas sobre os dados' },
    ],
  },
]

const TITLES = {
  dashboard:'Dashboard Executivo',
  plans:'Procedimentos',
  sales:'Cirurgias',
  consultations:'Consultas',
  products:'Modeladores e Produtos Pós-Operatórios',
  finance:'Financeiro',
  cashflow:'Fluxo de Caixa',
  dre:'DRE',
  balance:'Balanço Patrimonial',
  goals:'Metas',
  reports:'Relatórios Analíticos',
  ai:'Assistente ERP',
}

const SUBTITLES = {
  dashboard:'Indicadores-chave e leitura rápida da operação.',
  plans:'Organize o portfólio de procedimentos da clínica.',
  sales:'Cadastre cirurgias e acompanhe margem por operação.',
  consultations:'Controle consultas, convênios e recebimentos.',
  products:'Gerencie modeladores, compras, vendas e estoque.',
  finance:'Centralize entradas, saídas, contas, DRE e balanço.',
  cashflow:'Movimentações realizadas e saldo por período.',
  dre:'Resultado do período por competência.',
  balance:'Ativos, passivos e patrimônio da clínica.',
  goals:'Metas financeiras com progresso automático.',
  reports:'Relatórios analíticos para apoiar decisões.',
  ai:'Pergunte sobre lucro, caixa, metas e desempenho.',
}

const PAGES = {
  dashboard:Dashboard,
  plans:Plans,
  sales:Sales,
  consultations:Consultations,
  products:Products,
  finance:props => <Finance {...props} defaultTab="entradas" />,
  cashflow:props => <Finance {...props} defaultTab="fluxo" />,
  dre:props => <Finance {...props} defaultTab="dre" />,
  balance:props => <Finance {...props} defaultTab="balanco" />,
  goals:Goals,
  reports:Reports,
  ai:AIAssistant,
}

const FINANCE_ALIASES = new Set(['cashflow', 'dre', 'balance'])

export function FinanceWorkspace() {
  const { page = 'dashboard' } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [data, setRaw] = useState(createEmptyData)
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 1024 : false)
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

  const setData = updater => setRaw(prev => normalizeData(typeof updater === 'function' ? updater(prev) : updater))
  const hasData = useMemo(() => data.procedures.length || data.surgeries.length || data.consultations.length || data.products.length || data.productSales.length || data.productPurchases.length || data.extraRevenues.length || data.expenses.length || data.assets.length || data.liabilities.length || data.goals.length, [data])

  if (!PAGES[page]) return <Navigate to="/app/dashboard" replace />

  const Page = PAGES[page]
  const dateStr = new Date().toLocaleDateString('pt-BR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
  const sidebarQuickStats = [
    `Caixa ${fmt(summary.cashBalance)}`,
    `${summary.surgeriesCompleted} cirurgia(s)`,
    `${summary.consultationsCompleted} consulta(s)`,
  ]
  const quickLinks = NAV_SECTIONS.flatMap(section => section.items).slice(0, 4)

  if (loading) {
    return <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:C.bg }}><Card style={{ width:'min(420px, calc(100vw - 32px))', textAlign:'center' }}><div style={{ fontSize:14, color:C.textSub }}>Carregando dados da sua conta...</div></Card></div>
  }

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:C.bg }}>
      {isMobile && mobileNavOpen && <div onClick={() => setMobileNavOpen(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.56)', zIndex:30 }} />}

      <aside style={{ width:272, background:C.surface, borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', position:isMobile ? 'fixed' : 'sticky', left:isMobile ? 0 : 'auto', top:0, height:'100dvh', overflow:'hidden', flexShrink:0, zIndex:isMobile ? 40 : 10, transform:isMobile ? (mobileNavOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none', transition:'transform 0.25s ease' }}>
        <div style={{ padding:'24px 20px 18px', borderBottom:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
          <div>
            <div style={{ fontSize:18, fontWeight:800, letterSpacing:'-0.02em', color:C.text }}><span style={{ color:C.accent }}>▲</span> SurgiFlow</div>
            <div style={{ fontSize:11, color:C.textDim, marginTop:4 }}>ERP financeiro para cirurgia plástica</div>
          </div>
          {isMobile && <button onClick={() => setMobileNavOpen(false)} style={iconButton}>✕</button>}
        </div>

        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${C.border}`, background:C.accent+'08' }}>
          <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Conta ativa</div>
          <div style={{ fontSize:14, fontWeight:700, color:C.text }}>{user.user_metadata?.name || user.email}</div>
          <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>{user.email}</div>
        </div>

        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${C.border}`, background:'linear-gradient(180deg, transparent, rgba(59,130,246,0.06))' }}>
          <div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>Resumo rápido</div>
          <div style={{ fontSize:24, fontWeight:900, color:C.accent, marginBottom:8 }}>{fmt(summary.cashBalance)}</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {sidebarQuickStats.map(item => <div key={item} style={{ color:C.textDim, fontSize:12 }}>{item}</div>)}
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'14px 10px 18px' }}>
          {NAV_SECTIONS.map(section => (
            <div key={section.title} style={{ marginBottom:14 }}>
              <div style={{ padding:'0 10px 8px', fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.12em', fontWeight:700 }}>{section.title}</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {section.items.map(item => {
                  const active = item.id === page || (item.id === 'finance' && FINANCE_ALIASES.has(page))
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigate(`/app/${item.id}`)}
                      style={{
                        display:'grid',
                        gridTemplateColumns:'20px 1fr',
                        gap:12,
                        alignItems:'start',
                        padding:'12px 14px',
                        borderRadius:12,
                        cursor:'pointer',
                        fontFamily:'inherit',
                        background:active ? C.accent+'16' : 'transparent',
                        color:active ? C.text : C.textSub,
                        fontSize:14,
                        width:'100%',
                        textAlign:'left',
                        border:active ? `1px solid ${C.accent}40` : '1px solid transparent',
                      }}
                    >
                      <span style={{ fontSize:16, opacity:active ? 1 : 0.5, lineHeight:1.2 }}>{item.icon}</span>
                      <span>
                        <span style={{ display:'block', fontWeight:active ? 700 : 600 }}>{item.label}</span>
                        <span style={{ display:'block', color:active ? C.textSub : C.textDim, fontSize:11, marginTop:3 }}>{item.hint}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding:'12px 10px 14px', borderTop:`1px solid ${C.border}` }}>
          <button onClick={signOut} style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:`1px solid ${C.border}`, background:'transparent', color:C.textDim, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>Sair da conta</button>
        </div>
      </aside>

      <main style={{ flex:1, overflowY:'auto', padding:isMobile ? '20px 16px 56px' : '28px 28px 64px', marginLeft:isMobile ? 0 : 0 }}>
        <div style={{ marginBottom:22 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
              {isMobile && <button onClick={() => setMobileNavOpen(true)} style={iconButton}>☰</button>}
              <div>
                <h1 style={{ margin:0, fontSize:isMobile ? 24 : 28, fontWeight:900, letterSpacing:'-0.03em', color:C.text }}>{TITLES[page]}</h1>
                <div style={{ fontSize:13, color:C.textDim, marginTop:6, textTransform:'capitalize' }}>{dateStr}</div>
                <div style={{ fontSize:14, color:C.textSub, marginTop:10, maxWidth:620 }}>{SUBTITLES[page]}</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {quickLinks.map(item => {
                const active = item.id === page
                return <button key={item.id} onClick={() => navigate(`/app/${item.id}`)} style={{ padding:'8px 12px', borderRadius:999, border:active ? `1px solid ${C.accent}44` : `1px solid ${C.border}`, background:active ? C.accent+'14' : 'transparent', color:active ? C.accentLight : C.textSub, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>{item.label}</button>
              })}
            </div>
          </div>
        </div>

        {loadError && <Card style={{ marginBottom:16, border:`1px solid ${C.red}33` }}><div style={{ color:C.red, fontSize:13 }}>{loadError}</div></Card>}
        {saveError && <Card style={{ marginBottom:16, border:`1px solid ${C.yellow}33` }}><div style={{ color:C.yellow, fontSize:13 }}>Falha ao sincronizar com o backend. As alterações continuam na tela, mas não foram confirmadas no Supabase.</div></Card>}
        {!hasData && <Card style={{ marginBottom:20, border:`1px solid ${C.accent}33`, background:`linear-gradient(135deg, ${C.surface}, ${C.card})` }}><div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', alignItems:'center' }}><div><div style={{ fontSize:12, color:C.accentLight, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>ERP vazio</div><div style={{ fontSize:18, fontWeight:700, color:C.text }}>Comece a operação sem digitação duplicada.</div><div style={{ fontSize:13, color:C.textSub, marginTop:6 }}>Cadastre procedimentos, cirurgias, consultas, produtos e despesas. O resto alimenta fluxo, DRE, balanço, metas e dashboard automaticamente.</div></div><div style={{ fontSize:12, color:C.textDim, lineHeight:1.6 }}>Primeiro passo recomendado:<div>1. Procedimentos</div><div>2. Cirurgias, consultas e produtos</div><div>3. Despesas e metas</div></div></div></Card>}
        <Page data={data} setData={setData} />
      </main>
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
