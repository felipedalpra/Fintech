import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { C } from '../theme.js'
import { fmt } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card } from '../components/UI.jsx'
import { Dashboard } from '../components/Dashboard.jsx'
import { Sales } from '../components/Sales.jsx'
import { Plans } from '../components/Plans.jsx'
import { Finance } from '../components/Finance.jsx'
import { Goals } from '../components/Goals.jsx'
import { AIAssistant } from '../components/AIAssistant.jsx'
import { Consultations } from '../components/Consultations.jsx'
import { Reports } from '../components/Reports.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { createEmptyData, normalizeData } from '../dataModel.js'
import { importLegacyDataIfNeeded, saveFinanceData } from '../lib/financeStore.js'

const NAV = [
  { id:'dashboard', label:'Dashboard', icon:'⬡' },
  { id:'plans', label:'Procedimentos', icon:'◇' },
  { id:'sales', label:'Cirurgias', icon:'◈' },
  { id:'consultations', label:'Consultas', icon:'◎' },
  { id:'finance', label:'Financeiro', icon:'◆' },
  { id:'goals', label:'Metas', icon:'◉' },
  { id:'reports', label:'Relatórios', icon:'◫' },
  { id:'ai', label:'Assistente', icon:'✦' },
]

const TITLES = {
  dashboard:'Dashboard Executivo',
  plans:'Procedimentos',
  sales:'Cirurgias',
  consultations:'Consultas',
  finance:'Financeiro',
  goals:'Metas',
  reports:'Relatórios Analíticos',
  ai:'Assistente ERP',
}

const PAGES = {
  dashboard:Dashboard,
  plans:Plans,
  sales:Sales,
  consultations:Consultations,
  finance:Finance,
  goals:Goals,
  reports:Reports,
  ai:AIAssistant,
}

export function FinanceWorkspace() {
  const { page = 'dashboard' } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [data, setRaw] = useState(createEmptyData)
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState('')
  const [loadError, setLoadError] = useState('')
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

  const setData = updater => setRaw(prev => normalizeData(typeof updater === 'function' ? updater(prev) : updater))
  const hasData = useMemo(() => data.procedures.length || data.surgeries.length || data.consultations.length || data.extraRevenues.length || data.expenses.length || data.assets.length || data.liabilities.length || data.goals.length, [data])

  if (!PAGES[page]) return <Navigate to="/app/dashboard" replace />

  const Page = PAGES[page]
  const dateStr = new Date().toLocaleDateString('pt-BR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })

  if (loading) {
    return <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:C.bg }}><Card style={{ width:'min(420px, calc(100vw - 32px))', textAlign:'center' }}><div style={{ fontSize:14, color:C.textSub }}>Carregando dados da sua conta...</div></Card></div>
  }

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:C.bg }}>
      <aside style={{ width:250, background:C.surface, borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', padding:'0 0 20px', position:'sticky', top:0, height:'100vh', flexShrink:0 }}>
        <div style={{ padding:'24px 20px 20px', borderBottom:`1px solid ${C.border}` }}><div style={{ fontSize:18, fontWeight:800, letterSpacing:'-0.02em', color:C.text }}><span style={{ color:C.accent }}>▲</span> StartupFinance</div><div style={{ fontSize:11, color:C.textDim, marginTop:4 }}>ERP financeiro para cirurgia plástica</div></div>
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${C.border}`, background:C.accent+'08' }}><div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Conta ativa</div><div style={{ fontSize:14, fontWeight:700, color:C.text }}>{user.user_metadata?.name || user.email}</div><div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>{user.email}</div></div>
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${C.border}`, background:C.accent+'08' }}><div style={{ fontSize:10, color:C.textDim, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:4 }}>Resumo rápido</div><div style={{ fontSize:22, fontWeight:800, color:C.accent }}>{fmt(summary.cashBalance)}</div><div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>Caixa atual · {summary.surgeriesCompleted} cirurgia(s) · {summary.consultationsCompleted} consulta(s)</div></div>
        <nav style={{ flex:1, padding:'12px 10px', display:'flex', flexDirection:'column', gap:2 }}>{NAV.map(item => { const active = page === item.id; return <button key={item.id} onClick={() => navigate(`/app/${item.id}`)} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', borderRadius:10, border:'none', cursor:'pointer', fontFamily:'inherit', background:active ? C.accent+'1A' : 'transparent', color:active ? C.accent : C.textSub, fontWeight:active ? 700 : 500, fontSize:14, width:'100%', textAlign:'left', borderLeft:active ? `2px solid ${C.accent}` : '2px solid transparent' }}><span style={{ fontSize:16, opacity:active ? 1 : 0.5 }}>{item.icon}</span>{item.label}</button> })}</nav>
        <div style={{ padding:'0 10px' }}><button onClick={signOut} style={{ width:'100%', padding:'8px 14px', borderRadius:10, border:`1px solid ${C.border}`, background:'transparent', color:C.textDim, fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>Sair da conta</button></div>
      </aside>

      <main style={{ flex:1, overflowY:'auto', padding:'32px 32px 64px' }}>
        <div style={{ marginBottom:28 }}><h1 style={{ margin:0, fontSize:26, fontWeight:800, letterSpacing:'-0.02em', color:C.text }}>{TITLES[page]}</h1><div style={{ fontSize:13, color:C.textDim, marginTop:5, textTransform:'capitalize' }}>{dateStr}</div></div>
        {loadError && <Card style={{ marginBottom:16, border:`1px solid ${C.red}33` }}><div style={{ color:C.red, fontSize:13 }}>{loadError}</div></Card>}
        {saveError && <Card style={{ marginBottom:16, border:`1px solid ${C.yellow}33` }}><div style={{ color:C.yellow, fontSize:13 }}>Falha ao sincronizar com o backend. As alterações continuam na tela, mas não foram confirmadas no Supabase.</div></Card>}
        {!hasData && <Card style={{ marginBottom:20, border:`1px solid ${C.accent}33`, background:`linear-gradient(135deg, ${C.surface}, ${C.card})` }}><div style={{ display:'flex', justifyContent:'space-between', gap:16, flexWrap:'wrap', alignItems:'center' }}><div><div style={{ fontSize:12, color:C.accentLight, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>ERP vazio</div><div style={{ fontSize:18, fontWeight:700, color:C.text }}>Comece a operação sem digitação duplicada.</div><div style={{ fontSize:13, color:C.textSub, marginTop:6 }}>Cadastre procedimentos, cirurgias, consultas e despesas. O resto alimenta fluxo, DRE, balanço, metas e dashboard automaticamente.</div></div><div style={{ fontSize:12, color:C.textDim, lineHeight:1.6 }}>Primeiro passo recomendado:<div>1. Procedimentos</div><div>2. Cirurgias e consultas</div><div>3. Despesas e metas</div></div></div></Card>}
        <Page data={data} setData={setData} />
      </main>
    </div>
  )
}
