import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { getPeriodRange } from '../utils.js'
import { supabase } from '../lib/supabase.js'
import { buildAllReports, buildReport, getReportDefinitions } from '../lib/reportCatalog.js'
import { exportCompleteWorkbook, exportReportWorkbook } from '../lib/reportWorkbook.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Btn, Card, FInput, SkeletonBlock } from './UI.jsx'

const PERIOD_OPTIONS = [
  { v:'month', l:'Mês atual' },
  { v:'quarter', l:'Trimestre atual' },
  { v:'semester', l:'Semestre atual' },
  { v:'year', l:'Ano atual' },
  { v:'custom', l:'Personalizado' },
]

const CATEGORY_OPTIONS = [
  { v:'all', l:'Todos os relatórios' },
  { v:'financeiro', l:'Financeiro' },
  { v:'estoque', l:'Estoque e produtos' },
  { v:'operacao', l:'Operação clínica' },
  { v:'clientes', l:'Clientes' },
  { v:'gestao', l:'Gestão e auditoria' },
]

export function Reports({ data }) {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id
  const [period, setPeriod] = useState('month')
  const [customRange, setCustomRange] = useState({ start:'', end:'' })
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [patients, setPatients] = useState([])
  const [recurrences, setRecurrences] = useState([])
  const [loadingAuxiliary, setLoadingAuxiliary] = useState(true)
  const [loadWarning, setLoadWarning] = useState('')
  const [exporting, setExporting] = useState('')
  const range = useMemo(() => getPeriodRange(period, customRange), [period, customRange.start, customRange.end])
  const invalidRange = !range.start || !range.end || range.start > range.end

  useEffect(() => {
    if (!effectiveUserId || !supabase) {
      setLoadingAuxiliary(false)
      if (!supabase) setLoadWarning('A conexão com o banco não está configurada neste ambiente. As exportações ficam bloqueadas para evitar arquivos incompletos.')
      return
    }
    let active = true
    setLoadingAuxiliary(true)
    setLoadWarning('')

    Promise.all([
      supabase.from('patients').select('id, full_name, cpf, date_of_birth, sex, phone, email, profession, address_city, address_state, start_date, active, created_at').eq('user_id', effectiveUserId).order('full_name'),
      supabase.from('recorrencias').select('*').eq('user_id', effectiveUserId).order('created_at'),
    ]).then(([patientsResult, recurrencesResult]) => {
      if (!active) return
      setPatients(patientsResult.data || [])
      setRecurrences((recurrencesResult.data || []).map(mapRecurrence))
      const errors = [patientsResult.error, recurrencesResult.error].filter(Boolean)
      if (errors.length) setLoadWarning('Parte dos dados auxiliares não pôde ser carregada. Recarregue antes de exportar para evitar relatórios incompletos.')
    }).catch(() => {
      if (!active) return
      setLoadWarning('Pacientes e recorrências não puderam ser carregados. Recarregue antes de exportar.')
    }).finally(() => {
      if (active) setLoadingAuxiliary(false)
    })

    return () => { active = false }
  }, [effectiveUserId])

  const context = useMemo(() => ({ data, patients, recurrences, range, generatedAt:new Date().toISOString() }), [data, patients, recurrences, range.start, range.end])
  const reports = useMemo(() => invalidRange ? [] : buildAllReports(context), [context, invalidRange])
  const definitions = useMemo(() => getReportDefinitions(), [])
  const reportsById = useMemo(() => new Map(reports.map(item => [item.id, item])), [reports])

  const visibleDefinitions = definitions.filter(item => {
    if (category !== 'all' && item.category !== category) return false
    const normalized = search.trim().toLowerCase()
    if (!normalized) return true
    return `${item.title} ${item.description} ${item.categoryLabel}`.toLowerCase().includes(normalized)
  })

  const grouped = CATEGORY_OPTIONS.slice(1).map(group => ({
    ...group,
    reports:visibleDefinitions.filter(item => item.category === group.v),
  })).filter(group => group.reports.length)

  const dataQuality = reportsById.get('data-quality')
  const criticalIssues = dataQuality?.rows?.filter(item => item.severity === 'Crítico').length || 0
  const structuralIssues = dataQuality?.rows?.filter(item => item.severity === 'Estrutural').length || 0
  const totalRows = reports.reduce((total, item) => total + (item.rows?.length || 0), 0)

  function exportOne(reportId) {
    if (invalidRange || loadingAuxiliary || loadWarning) return
    setExporting(reportId)
    try {
      exportReportWorkbook(buildReport(reportId, { ...context, generatedAt:new Date().toISOString() }))
    } finally {
      setExporting('')
    }
  }

  function exportAll() {
    if (invalidRange || loadingAuxiliary || loadWarning) return
    setExporting('all')
    try {
      exportCompleteWorkbook(buildAllReports({ ...context, generatedAt:new Date().toISOString() }), range)
    } finally {
      setExporting('')
    }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <Card style={{ background:`linear-gradient(135deg, ${C.card}, ${C.surface})` }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:18, alignItems:'flex-start', flexWrap:'wrap' }}>
          <div style={{ maxWidth:720 }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:7, color:C.green, fontSize:11, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>
              <span>●</span> Dados integrados em tempo real
            </div>
            <h2 style={{ margin:'0 0 8px', color:C.text, fontSize:22 }}>Central de Relatórios</h2>
            <p style={{ margin:0, color:C.textSub, fontSize:13, lineHeight:1.65 }}>
              Exporte relatórios financeiros, operacionais, de estoque e clientes em Excel. Cada arquivo inclui metodologia, fontes, período e alertas de integridade para facilitar conferência e auditoria.
            </p>
          </div>
          <Btn onClick={exportAll} disabled={invalidRange || loadingAuxiliary || Boolean(loadWarning) || exporting} style={{ padding:'11px 18px' }}>
            {exporting === 'all' ? 'Preparando Excel…' : '↓ Exportar pacote completo'}
          </Btn>
        </div>
      </Card>

      <Card>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, alignItems:'end' }}>
          <FInput label="Período" value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
          {period === 'custom' && <FInput label="Data inicial" type="date" value={customRange.start} onChange={start => setCustomRange(current => ({ ...current, start }))} />}
          {period === 'custom' && <FInput label="Data final" type="date" value={customRange.end} onChange={end => setCustomRange(current => ({ ...current, end }))} />}
          <FInput label="Categoria" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
          <FInput label="Buscar relatório" value={search} onChange={setSearch} placeholder="Ex.: estoque, clientes, DRE…" />
        </div>
        {invalidRange && <p style={{ margin:'12px 0 0', color:C.red, fontSize:12 }}>Informe um período válido para calcular e exportar os relatórios.</p>}
      </Card>

      {loadWarning && (
        <Card style={{ border:`1px solid ${C.red}55`, background:C.red+'0A' }}>
          <div style={{ color:C.red, fontSize:13, lineHeight:1.6 }}>{loadWarning}</div>
        </Card>
      )}

      {loadingAuxiliary ? (
        <LoadingState />
      ) : (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:12 }}>
            <Metric label="Relatórios disponíveis" value={definitions.length} color={C.accentLight} />
            <Metric label="Linhas preparadas" value={totalRows} color={C.cyan} />
            <Metric label="Pendências críticas" value={criticalIssues} color={criticalIssues ? C.red : C.green} />
            <Metric label="Limitações estruturais" value={structuralIssues} color={structuralIssues ? C.yellow : C.green} />
          </div>

          {dataQuality && (criticalIssues > 0 || structuralIssues > 0) && (
            <Card style={{ border:`1px solid ${criticalIssues ? C.red : C.yellow}44` }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:14, flexWrap:'wrap' }}>
                <div>
                  <div style={{ color:criticalIssues ? C.red : C.yellow, fontWeight:800, fontSize:13 }}>Conferência recomendada antes do fechamento</div>
                  <div style={{ color:C.textSub, fontSize:12, marginTop:4, lineHeight:1.55 }}>
                    Há {criticalIssues} pendência(s) crítica(s) e {structuralIssues} limitação(ões) do modelo atual. Exporte “Qualidade dos dados” para localizar cada registro.
                  </div>
                </div>
                <Btn variant="ghost" onClick={() => exportOne('data-quality')} disabled={Boolean(loadWarning)}>↓ Ver pendências em Excel</Btn>
              </div>
            </Card>
          )}

          {grouped.length === 0 ? (
            <Card><p style={{ margin:0, color:C.textDim, fontSize:13 }}>Nenhum relatório encontrado para os filtros informados.</p></Card>
          ) : grouped.map(group => (
            <section key={group.v}>
              <div style={{ display:'flex', alignItems:'center', gap:10, margin:'4px 0 10px' }}>
                <h3 style={{ margin:0, color:C.text, fontSize:14 }}>{group.l}</h3>
                <span style={{ color:C.textDim, fontSize:11 }}>{group.reports.length} relatório(s)</span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:12 }}>
                {group.reports.map(definition => {
                  const built = reportsById.get(definition.id)
                  const warningCount = built?.warnings?.length || 0
                  return (
                    <Card key={definition.id} style={{ padding:18, display:'flex', flexDirection:'column', minHeight:190 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'flex-start' }}>
                        <div style={{ width:36, height:36, borderRadius:10, background:C.accent+'18', color:C.accentLight, display:'grid', placeItems:'center', fontSize:17, fontWeight:900 }}>▦</div>
                        <span style={{ padding:'4px 8px', borderRadius:999, background:C.green+'14', color:C.green, fontSize:10, fontWeight:800 }}>EXCEL .XLSX</span>
                      </div>
                      <div style={{ marginTop:12, color:C.text, fontSize:15, fontWeight:800 }}>{definition.title}</div>
                      <div style={{ marginTop:5, color:C.textDim, fontSize:12, lineHeight:1.55, flex:1 }}>{definition.description}</div>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginTop:14, paddingTop:12, borderTop:`1px solid ${C.border}` }}>
                        <div style={{ color:C.textDim, fontSize:11 }}>
                          <strong style={{ color:C.textSub }}>{built?.rows?.length || 0}</strong> linha(s)
                          {warningCount > 0 && <span style={{ color:C.yellow }}> · {warningCount} alerta(s)</span>}
                        </div>
                        <Btn variant="ghost" onClick={() => exportOne(definition.id)} disabled={invalidRange || Boolean(loadWarning) || Boolean(exporting)} style={{ padding:'7px 12px', fontSize:12 }}>
                          {exporting === definition.id ? 'Gerando…' : '↓ Exportar'}
                        </Btn>
                      </div>
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function mapRecurrence(item) {
  return {
    id:item.id,
    tipo:item.tipo || 'despesa',
    descricao:item.descricao || '',
    valor:Number(item.valor || 0),
    categoria:item.categoria || 'outros',
    frequencia:item.frequencia || 'mensal',
    diaExecucao:Number(item.dia_execucao || 1),
    dataInicio:item.data_inicio || '',
    dataFim:item.data_fim || '',
    autoMarkAsPaid:Boolean(item.auto_mark_as_paid),
    ativo:item.ativo !== false,
  }
}

function Metric({ label, value, color }) {
  return (
    <Card style={{ padding:16 }}>
      <div style={{ color:C.textDim, fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em' }}>{label}</div>
      <div style={{ color, fontSize:24, fontWeight:900, marginTop:7 }}>{Number(value || 0).toLocaleString('pt-BR')}</div>
    </Card>
  )
}

function LoadingState() {
  return (
    <>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))', gap:12 }}>
        {[1,2,3,4].map(item => <Card key={item}><SkeletonBlock h={12} w="60%" /><SkeletonBlock h={28} w="35%" style={{ marginTop:10 }} /></Card>)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:12 }}>
        {[1,2,3,4,5,6].map(item => <Card key={item}><SkeletonBlock h={36} w={36} /><SkeletonBlock h={16} w="70%" style={{ marginTop:14 }} /><SkeletonBlock h={40} style={{ marginTop:10 }} /></Card>)}
      </div>
    </>
  )
}

