import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { C } from '../theme.js'
import { Btn, Card, FInput } from './UI.jsx'
import { fetchSecureProfile, saveSecureProfile } from '../lib/secureProfileClient.js'
import { supabase } from '../lib/supabase.js'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { buildClinicOrgChart, canSeeOrgChart, withClinicOwner } from '../lib/clinicTeamOrgChart.js'
import { useAuth } from '../context/AuthContext.jsx'
import { forceImportBrowserData } from '../lib/financeStore.js'
import { WhatsAppNumbers } from './WhatsAppNumbers.jsx'
import { WhatsAppAutomations } from './WhatsAppAutomations.jsx'
import { useMask } from '../lib/useMask.js'
import { MetaConnection } from './MetaConnection.jsx'
import { FollowupRules } from './FollowupRules.jsx'
import { IntegrationHealth } from './IntegrationHealth.jsx'
import { BillingConnection } from './BillingConnection.jsx'
import { clinicalSignerReadiness } from '../lib/clinicalSignature.js'
import { ExportPeriodFields } from './ExportPeriodFields.jsx'
import { emptyExportPeriod } from '../lib/exportPeriod.js'
import {
  BRAZIL_STATES, FIELD_STANDARDS, buildProfessionalRegistration, parseProfessionalRegistration,
  isValidCpf, isValidCnpj, isValidEmail, isValidPhone, isValidUf,
} from '../lib/formFieldStandards.js'

const EMPTY_PROFILE = {
  doctor:{
    fullName:'',
    professionalTitle:'Cirurgião plástico',
    specialty:'',
    registrationId:'',
    registrationState:'',
    registrationNumber:'',
    rqe:'',
    cpf:'',
    phone:'',
    email:'',
  },
  clinic:{
    legalName:'',
    tradeName:'',
    documentId:'',
    phone:'',
    email:'',
    website:'',
    addressLine:'',
    city:'',
    state:'',
    notes:'',
    logoDataUrl:'',
  },
}

export function Settings({ google, data }) {
  const whatsappSupportLink = `https://wa.me/5551991897471?text=${encodeURIComponent('quero falar com o suporte da SurgiMetrics')}`
  const { role, clinicId, clinicName, isOwner } = useUserRole()
  const [tab, setTab] = useState('perfil')
  const location = useLocation()
  useEffect(() => {
    if (new URLSearchParams(location.search).get('meta')) setTab('meta')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [profile, setProfile] = useState(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true

    async function loadProfile() {
      setLoading(true)
      setError('')
      try {
        const payload = await fetchSecureProfile()
        if (!active) return
        setProfile(mergeProfile(payload.profile))
      } catch (nextError) {
        if (!active) return
        setError(nextError.message || 'Nao foi possivel carregar as configuracoes.')
      } finally {
        if (active) setLoading(false)
      }
    }

    loadProfile()
    return () => { active = false }
  }, [])

  const profileSummary = useMemo(() => ({
    doctorFields:Object.entries(profile.doctor).filter(([key, value]) => !['registrationState', 'registrationNumber'].includes(key) && Boolean(value)).length,
    clinicFields:Object.entries(profile.clinic).filter(([key, value]) => key !== 'logoDataUrl' && Boolean(value)).length,
    hasLogo:Boolean(profile.clinic.logoDataUrl),
  }), [profile])

  const updateField = (section, field, value) => {
    setProfile(current => ({
      ...current,
      [section]:{
        ...current[section],
        [field]:value,
      },
    }))
    if (error) setError('')
    if (message) setMessage('')
  }

  const updateProfessionalRegistration = (field, value) => {
    setProfile(current => {
      const state = field === 'registrationState' ? value : current.doctor.registrationState
      const number = field === 'registrationNumber' ? value : current.doctor.registrationNumber
      return {
        ...current,
        doctor:{
          ...current.doctor,
          [field]:value,
          registrationId:buildProfessionalRegistration('CRM', state, number),
        },
      }
    })
    if (error) setError('')
    if (message) setMessage('')
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setMessage('')

    try {
      if (profile.doctor.cpf && !isValidCpf(profile.doctor.cpf)) throw new Error('Informe um CPF profissional válido.')
      if (profile.doctor.phone && !isValidPhone(profile.doctor.phone)) throw new Error('Informe o telefone profissional com DDD.')
      if (profile.doctor.email && !isValidEmail(profile.doctor.email)) throw new Error('Informe um e-mail profissional válido.')
      if (profile.doctor.registrationNumber && !isValidUf(profile.doctor.registrationState)) throw new Error('Selecione a UF do CRM.')
      if (profile.doctor.registrationState && !profile.doctor.registrationNumber) throw new Error('Informe o número do CRM.')
      if (profile.clinic.documentId && !isValidCnpj(profile.clinic.documentId) && !isValidCpf(profile.clinic.documentId)) throw new Error('Informe um CNPJ ou CPF válido para a clínica.')
      if (profile.clinic.phone && !isValidPhone(profile.clinic.phone)) throw new Error('Informe o telefone da clínica com DDD.')
      if (profile.clinic.email && !isValidEmail(profile.clinic.email)) throw new Error('Informe um e-mail válido para a clínica.')
      if (profile.clinic.state && !isValidUf(profile.clinic.state)) throw new Error('Selecione uma UF válida para a clínica.')
      await saveSecureProfile(profile)
      if (isOwner && clinicId) {
        const { error:clinicalIdentityError } = await supabase
          .from('clinics')
          .update({
            clinical_professional_name:profile.doctor.fullName.trim() || null,
            clinical_professional_registration:profile.doctor.registrationId.trim() || null,
            clinical_professional_council:'CRM',
          })
          .eq('id', clinicId)
        if (clinicalIdentityError) throw new Error('O perfil foi salvo, mas a identidade clínica não foi confirmada. Aplique a migração clínica e tente novamente.')
      }
      setMessage('Informações pessoais e da clínica salvas com sucesso!')
    } catch (nextError) {
      setError(nextError.message || 'Não foi possivel salvar as configuracoes.')
    } finally {
      setSaving(false)
    }
  }

  const onLogoSelected = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Selecione uma imagem válida para a logo.')
      return
    }
    if (file.size > 1_000_000) {
      setError('Use uma logo com até 1 MB.')
      return
    }

    const dataUrl = await readFileAsDataUrl(file)
    updateField('clinic', 'logoDataUrl', dataUrl)
  }

  const tabs = [
    { id:'perfil', label:'Perfil' },
    ...(role === 'admin' ? [{ id:'equipe', label:'Equipe' }, { id:'exportacao', label:'Exportação' }, { id:'integracoes', label:'Integrações' }, { id:'cobrancas', label:'Cobranças' }, { id:'whatsapp', label:'WhatsApp' }, { id:'meta', label:'Meta Ads' }, { id:'automacoes', label:'Automações' }, { id:'followup', label:'Régua de follow-up' }] : []),
  ]

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
      <Card style={{ maxWidth:920 }}>
        <div style={{ display:'flex', gap:0, marginBottom:24, borderBottom:`1px solid ${C.border}`, overflowX:'auto' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding:'10px 18px',
                border:'none',
                borderBottom: tab === t.id ? `2px solid ${C.accent}` : '2px solid transparent',
                background:'none',
                color: tab === t.id ? C.accent : C.textSub,
                fontWeight: tab === t.id ? 700 : 500,
                fontSize:14,
                cursor:'pointer',
                fontFamily:'inherit',
                marginBottom:-1,
              }}
            >{t.label}</button>
          ))}
        </div>

        {tab === 'perfil' && (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', flexWrap:'wrap' }}>
              <div>
                <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Perfil seguro</div>
                <h3 style={{ margin:'0 0 8px', fontSize:22, color:C.text, letterSpacing:'-0.03em' }}>Médico e clínica</h3>
                <p style={{ margin:0, color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:620 }}>
                  Registre aqui as suas informações e da sua clínica.
                </p>
              </div>
              <div style={{ display:'grid', gap:8, minWidth:220 }}>
                <MiniStatus label="Campos do médico" value={String(profileSummary.doctorFields)} />
                <MiniStatus label="Campos da clínica" value={String(profileSummary.clinicFields)} />
                <MiniStatus label="Logo" value={profileSummary.hasLogo ? 'Carregada' : 'Não enviada'} />
              </div>
            </div>

            {loading ? (
              <div style={{ marginTop:24, color:C.textSub }}>Carregando perfil seguro...</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:22, marginTop:24 }}>
                <SectionCard title="Informações do médico" subtitle="Preencha cada parte do registro separadamente. O sistema monta o CRM no padrão correto automaticamente.">
                  <Grid>
                    <FInput label="Nome completo" value={profile.doctor.fullName} onChange={value => updateField('doctor', 'fullName', value)} />
                    <FInput label="Título profissional" value={profile.doctor.professionalTitle} onChange={value => updateField('doctor', 'professionalTitle', value)} />
                    <FInput label="Especialidade" value={profile.doctor.specialty} onChange={value => updateField('doctor', 'specialty', value)} />
                    <FInput label="Conselho profissional" value="CRM" onChange={() => {}} options={[{ v:'CRM', l:'CRM — Conselho Regional de Medicina' }]} help="Para médicos, o conselho utilizado nos documentos e assinaturas é o CRM." />
                    <FInput label="UF do CRM" value={profile.doctor.registrationState} onChange={value => updateProfessionalRegistration('registrationState', value)} options={[{ v:'', l:'Selecione a UF' }, ...BRAZIL_STATES.map(state => ({ v:state, l:state }))]} required />
                    <FInput label="Número do CRM" value={profile.doctor.registrationNumber} onChange={value => updateProfessionalRegistration('registrationNumber', value)} placeholder="Ex.: 12345" required
                      format={FIELD_STANDARDS.registration.format} maxLength={FIELD_STANDARDS.registration.maxLength} inputMode={FIELD_STANDARDS.registration.inputMode} validator={FIELD_STANDARDS.registration.validate} help={profile.doctor.registrationId ? `Será salvo como ${profile.doctor.registrationId}` : 'Somente números.'} />
                    <FInput label="RQE (se houver)" value={profile.doctor.rqe} onChange={value => updateField('doctor', 'rqe', value)} placeholder="Ex.: 6789"
                      format={FIELD_STANDARDS.registration.format} maxLength={FIELD_STANDARDS.registration.maxLength} inputMode={FIELD_STANDARDS.registration.inputMode} validator={FIELD_STANDARDS.registration.validate} help="Número do Registro de Qualificação de Especialista, sem letras." />
                    <FInput label="CPF do profissional" value={profile.doctor.cpf} onChange={value => updateField('doctor', 'cpf', value)} placeholder="000.000.000-00"
                      format={FIELD_STANDARDS.cpf.format} maxLength={FIELD_STANDARDS.cpf.maxLength} inputMode={FIELD_STANDARDS.cpf.inputMode} validator={FIELD_STANDARDS.cpf.validate} />
                    <FInput label="Telefone" value={profile.doctor.phone} onChange={value => updateField('doctor', 'phone', value)} placeholder="(51) 99999-9999"
                      format={FIELD_STANDARDS.phone.format} maxLength={FIELD_STANDARDS.phone.maxLength} inputMode={FIELD_STANDARDS.phone.inputMode} validator={FIELD_STANDARDS.phone.validate} autoComplete="tel" />
                    <FInput label="E-mail profissional" type="email" value={profile.doctor.email} onChange={value => updateField('doctor', 'email', value)} placeholder="medico@clinica.com.br"
                      format={FIELD_STANDARDS.email.format} maxLength={FIELD_STANDARDS.email.maxLength} inputMode={FIELD_STANDARDS.email.inputMode} validator={FIELD_STANDARDS.email.validate} autoComplete="email" />
                  </Grid>
                </SectionCard>

                <SectionCard title="Assinatura clínica ICP-Brasil" subtitle="Base preparada para conectar um provedor de assinatura qualificada sem expor o certificado.">
                  <div style={{ display:'grid', gap:10 }}>
                    <div style={{ padding:'12px 14px', borderRadius:14, border:`1px solid ${C.border}`, background:C.surface, color:C.textSub, fontSize:13, lineHeight:1.6 }}>
                      <strong style={{ display:'block', color:C.text, marginBottom:4 }}>Integração com a BRy pronta, aguardando ativação</strong>
                      O certificado A1 e a senha não serão enviados pelo navegador nem gravados no Supabase. Quando o provedor for escolhido, o servidor guardará somente uma referência segura à credencial e os documentos receberão evidências verificáveis de assinatura.
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <MiniStatus label="Identidade" value={clinicalSignerReadiness(profile).ready ? 'Completa' : `Falta ${clinicalSignerReadiness(profile).missing.join(', ')}`} />
                      <MiniStatus label="Certificado" value="Na BRy, com o profissional" />
                      <MiniStatus label="Provedor" value="BRy Easy Sign" />
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Informações da clínica" subtitle="Dados institucionais para identidade visual, contato e documentos da operação.">
                  <Grid>
                    <FInput label="Razão social" value={profile.clinic.legalName} onChange={value => updateField('clinic', 'legalName', value)} />
                    <FInput label="Nome fantasia" value={profile.clinic.tradeName} onChange={value => updateField('clinic', 'tradeName', value)} />
                    <FInput label="CNPJ / CPF" value={profile.clinic.documentId} onChange={value => updateField('clinic', 'documentId', value)} placeholder="00.000.000/0000-00"
                      format={FIELD_STANDARDS.cpfCnpj.format} maxLength={FIELD_STANDARDS.cpfCnpj.maxLength} inputMode={FIELD_STANDARDS.cpfCnpj.inputMode} validator={FIELD_STANDARDS.cpfCnpj.validate} />
                    <FInput label="Telefone da clínica" value={profile.clinic.phone} onChange={value => updateField('clinic', 'phone', value)} placeholder="(51) 3333-4444"
                      format={FIELD_STANDARDS.phone.format} maxLength={FIELD_STANDARDS.phone.maxLength} inputMode={FIELD_STANDARDS.phone.inputMode} validator={FIELD_STANDARDS.phone.validate} />
                    <FInput label="E-mail da clínica" type="email" value={profile.clinic.email} onChange={value => updateField('clinic', 'email', value)} placeholder="contato@clinica.com.br"
                      format={FIELD_STANDARDS.email.format} maxLength={FIELD_STANDARDS.email.maxLength} inputMode={FIELD_STANDARDS.email.inputMode} validator={FIELD_STANDARDS.email.validate} />
                    <FInput label="Site" type="url" value={profile.clinic.website} onChange={value => updateField('clinic', 'website', value)} placeholder="https://www.clinica.com.br" />
                    <FInput label="Endereço" value={profile.clinic.addressLine} onChange={value => updateField('clinic', 'addressLine', value)} />
                    <FInput label="Cidade" value={profile.clinic.city} onChange={value => updateField('clinic', 'city', value)} />
                    <FInput label="Estado (UF)" value={profile.clinic.state} onChange={value => updateField('clinic', 'state', value)} options={[{ v:'', l:'Selecione a UF' }, ...BRAZIL_STATES.map(state => ({ v:state, l:state }))]} />
                    <FInput label="Observações institucionais" value={profile.clinic.notes} onChange={value => updateField('clinic', 'notes', value)} />
                  </Grid>

                  <div style={{ marginTop:18 }}>
                    <label style={{ display:'block', fontSize:12, color:C.textSub, fontWeight:700, marginBottom:10 }}>Logo da clínica</label>
                    <div style={{ display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
                      <div style={{ width:96, height:96, borderRadius:20, border:`1px solid ${C.border}`, background:C.surface, display:'grid', placeItems:'center', overflow:'hidden' }}>
                        {profile.clinic.logoDataUrl ? <img src={profile.clinic.logoDataUrl} alt="Logo da clínica" style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <span style={{ color:C.textDim, fontSize:12 }}>Sem logo</span>}
                      </div>
                      <div style={{ display:'grid', gap:10 }}>
                        <input type="file" accept="image/*" onChange={onLogoSelected} />
                        {profile.clinic.logoDataUrl ? <Btn variant="ghost" onClick={() => updateField('clinic', 'logoDataUrl', '')}>Remover logo</Btn> : null}
                        <div style={{ color:C.textDim, fontSize:12 }}> Use arquivos de até 1 MB.</div>
                      </div>
                    </div>
                  </div>
                </SectionCard>

                {error ? <Feedback color={C.red} text={error} /> : null}
                {message ? <Feedback color={C.green} text={message} /> : null}

                <div style={{ display:'flex', justifyContent:'flex-end' }}>
                  <Btn onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar configurações seguras'}</Btn>
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'equipe' && role === 'admin' && (
          <TeamSettings clinicId={clinicId} />
        )}

        {tab === 'exportacao' && role === 'admin' && (
          <FullPlatformExport data={data} profile={profile} clinicName={clinicName} loadingProfile={loading} />
        )}

        {tab === 'integracoes' && role === 'admin' && (
          <IntegrationHealth google={google} />
        )}

        {tab === 'cobrancas' && role === 'admin' && (
          <BillingConnection />
        )}

        {tab === 'whatsapp' && role === 'admin' && (
          <WhatsAppNumbers />
        )}
        {tab === 'meta' && role === 'admin' && (
          <MetaConnection />
        )}
        {tab === 'automacoes' && role === 'admin' && (
          <WhatsAppAutomations />
        )}
        {tab === 'followup' && role === 'admin' && (
          <FollowupRules />
        )}
      </Card>

      <Card style={{ maxWidth:920 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:20, alignItems:'center', flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Suporte</div>
            <h3 style={{ margin:'0 0 8px', fontSize:22, color:C.text, letterSpacing:'-0.03em' }}>Ajuda da plataforma</h3>
            <p style={{ margin:'0 0 10px', color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:680 }}>
              Use este canal para tirar dúvidas sobre cadastros, lançamentos financeiros, metas, relatórios e rotinas do SurgiMetrics.
            </p>
            <p style={{ margin:0, color:C.textDim, fontSize:13, lineHeight:1.7, maxWidth:680 }}>
              Para agilizar o atendimento, descreva a tela em que está, o que tentou fazer e, se possível, envie um print do erro.
            </p>
          </div>

          <a
            href={whatsappSupportLink}
            target="_blank"
            rel="noreferrer"
            style={{
              display:'inline-flex',
              alignItems:'center',
              justifyContent:'center',
              padding:'10px 18px',
              borderRadius:10,
              border:'none',
              background:C.accent,
              color:'#fff',
              fontSize:13,
              fontWeight:600,
              textDecoration:'none',
              whiteSpace:'nowrap',
              fontFamily:'inherit',
            }}
          >
            Falar com o suporte no WhatsApp
          </a>
        </div>
      </Card>

      <BrowserDataRecovery />
    </div>
  )
}

// Recuperação de dados presos no localStorage DESTE navegador (blindagem Fase 2).
// Importa para a nuvem por merge (só adiciona o que falta; nunca apaga).
function BrowserDataRecovery() {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  const run = async () => {
    if (running) return
    setRunning(true); setErr(''); setResult(null)
    try {
      const res = await forceImportBrowserData(user, ownerId || user?.id)
      if (res.error) { setErr(res.error) }
      else {
        setResult(res.message)
        // Importou algo: recarrega para a tela refletir os dados trazidos (e o baseline resync).
        if (res.imported > 0) setTimeout(() => { try { window.location.reload() } catch { /* ignore */ } }, 1500)
      }
    } catch (e) {
      setErr(e?.message || 'Falha ao importar os dados deste navegador.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card style={{ maxWidth:920 }}>
      <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Recuperação</div>
      <h3 style={{ margin:'0 0 8px', fontSize:22, color:C.text, letterSpacing:'-0.03em' }}>Importar dados deste navegador</h3>
      <p style={{ margin:'0 0 14px', color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:680 }}>
        Se você cadastrou lançamentos antigos neste computador/navegador e eles não aparecem, clique abaixo para
        enviá-los à nuvem. É seguro: apenas <strong>adiciona</strong> o que estiver faltando — nunca apaga nem
        sobrescreve o que já está salvo. Rode no mesmo navegador onde cadastrou.
      </p>
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        <Btn onClick={run} disabled={running}>{running ? 'Importando…' : 'Importar deste navegador'}</Btn>
        {result && <span style={{ color:C.green, fontSize:13, fontWeight:600 }}>{result}</span>}
        {err && <span style={{ color:C.red, fontSize:13, fontWeight:600 }}>{err}</span>}
      </div>
    </Card>
  )
}

const ROLE_LABELS = { admin:'Administrador', gestao:'Gestão', concierge:'Concierge', equipe:'Equipe' }

function FullPlatformExport({ data, profile, clinicName, loadingProfile }) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportMessage, setExportMessage] = useState('')
  const [period, setPeriod] = useState(emptyExportPeriod)

  async function runExport() {
    if (exporting) return
    setExporting(true)
    setExportError('')
    setExportMessage('')
    try {
      const { exportAllPlatformWorkbook } = await import('../lib/platformExport.js')
      const result = await exportAllPlatformWorkbook({ data, profile, clinicName, database:supabase, period })
      setExportMessage(result.warnings.length
        ? `Excel de ${result.period.label.toLowerCase()} gerado com ${result.sheetCount} abas de dados e ${result.warnings.length} aviso(s). Confira a aba “Visão Geral”.`
        : `Excel de ${result.period.label.toLowerCase()} gerado com sucesso com ${result.sheetCount} abas de dados.`)
    } catch (nextError) {
      setExportError(nextError?.message || 'Não foi possível gerar a exportação completa.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
      <div>
        <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Portabilidade dos dados</div>
        <h3 style={{ margin:'0 0 8px', fontSize:22, color:C.text, letterSpacing:'-0.03em' }}>Exportar todos os dados</h3>
        <p style={{ margin:0, color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:700 }}>
          Baixe uma planilha Excel consolidada, dividida por funcionalidade: pacientes, cirurgias, consultas, produtos, financeiro, CRM, clínico, WhatsApp, Meta Ads, equipe e demais registros disponíveis para esta clínica.
        </p>
      </div>

      <div style={{ padding:'14px 16px', borderRadius:14, border:`1px solid ${C.yellow}55`, background:C.yellow+'0D', color:C.textSub, fontSize:13, lineHeight:1.65 }}>
        <strong style={{ color:C.text }}>Arquivo confidencial.</strong> A planilha é montada localmente no navegador e pode conter dados pessoais, financeiros e de saúde. Guarde-a em local seguro. Senhas, tokens e credenciais de integrações nunca são incluídos.
      </div>

      <div style={{ display:'flex', gap:18, alignItems:'flex-end', flexWrap:'wrap' }}>
        <ExportPeriodFields value={period} onChange={setPeriod} disabled={exporting || loadingProfile} compact />
        <div style={{ display:'flex', flexDirection:'column', gap:8, alignItems:'flex-start' }}>
          <Btn onClick={runExport} disabled={exporting || loadingProfile} style={{ padding:'11px 18px' }}>
            {exporting ? 'Carregando dados e gerando Excel…' : '↓ Exportar tudo em Excel'}
          </Btn>
          <span style={{ color:C.textDim, fontSize:12, maxWidth:430 }}>Cada assunto é organizado em uma aba própria, com clínica, período, data e horário da geração.</span>
        </div>
      </div>

      {exportMessage ? <Feedback color={C.green} text={exportMessage} /> : null}
      {exportError ? <Feedback color={C.red} text={exportError} /> : null}
    </div>
  )
}

function TeamSettings({ clinicId }) {
  const mask = useMask()
  const { role, ownerId } = useUserRole()
  const showOrgChart = canSeeOrgChart(role)
  const [teamView, setTeamView] = useState('lista')
  const [highlightedMember, setHighlightedMember] = useState('')
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('equipe')
  const [inviting, setInviting] = useState(false)
  const [teamError, setTeamError] = useState('')
  const [teamMessage, setTeamMessage] = useState('')

  const loadMembers = async () => {
    if (!clinicId) return
    setLoadingMembers(true)
    // O dono da clínica NÃO tem linha em clinic_members (ver supabase/clinic_owner_profile.sql).
    // Sem buscá-lo à parte, ele some da equipe inteira — inclusive para ele mesmo.
    const [{ data, error }, ownerResult] = await Promise.all([
      supabase
        .from('clinic_members')
        .select('id, user_id, role, member_email, clinical_access, professional_name, professional_registration, professional_council, created_at')
        .eq('clinic_id', clinicId)
        .order('created_at'),
      supabase.rpc('clinic_owner_profile'),
    ])
    const owner = Array.isArray(ownerResult?.data) ? ownerResult.data[0] : ownerResult?.data
    if (!error) setMembers(withClinicOwner(data ?? [], ownerResult?.error ? null : owner))
    setLoadingMembers(false)
  }

  useEffect(() => { loadMembers() }, [clinicId])

  const invite = async () => {
    if (!inviteEmail.trim()) return
    if (!isValidEmail(inviteEmail)) { setTeamError('Informe um e-mail válido.'); return }
    setInviting(true)
    setTeamError('')
    setTeamMessage('')

    const { data: userId, error: lookupError } = await supabase
      .rpc('get_user_id_by_email', { lookup_email: inviteEmail.trim().toLowerCase() })

    if (lookupError || !userId) {
      setTeamError('Usuário não encontrado. Verifique se o e-mail está cadastrado na plataforma.')
      setInviting(false)
      return
    }

    const { error: insertError } = await supabase
      .from('clinic_members')
      .insert({ clinic_id: clinicId, user_id: userId, role: inviteRole, member_email: inviteEmail.trim().toLowerCase() })

    if (insertError) {
      setTeamError(insertError.code === '23505' ? 'Esse usuário já é membro da clínica.' : insertError.message)
    } else {
      setTeamMessage(`${inviteEmail} adicionado como ${ROLE_LABELS[inviteRole]}.`)
      setInviteEmail('')
      await loadMembers()
    }
    setInviting(false)
  }

  const changeRole = async (memberId, newRole) => {
    const { error } = await supabase
      .from('clinic_members')
      .update({ role: newRole })
      .eq('id', memberId)
    if (!error) setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m))
  }

  const updateClinicalIdentity = async (memberId, patch) => {
    const { error } = await supabase
      .from('clinic_members')
      .update(patch)
      .eq('id', memberId)
    if (!error) setMembers(prev => prev.map(m => m.id === memberId ? { ...m, ...patch } : m))
    else setTeamError(error.message || 'Não foi possível atualizar o acesso clínico.')
  }

  const removeMember = async (memberId) => {
    const { error } = await supabase
      .from('clinic_members')
      .delete()
      .eq('id', memberId)
    if (!error) setMembers(prev => prev.filter(m => m.id !== memberId))
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div>
        <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Controle de acesso</div>
        <h3 style={{ margin:'0 0 6px', fontSize:22, color:C.text, letterSpacing:'-0.03em' }}>Equipe</h3>
        <p style={{ margin:0, color:C.textSub, fontSize:14, lineHeight:1.7 }}>
          Adicione colaboradores e defina o nível de acesso de cada um.
        </p>
      </div>

      <SectionCard title="Convidar membro" subtitle="O usuário precisa ter uma conta ativa na plataforma.">
        <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:220 }}>
            <FInput
              label="E-mail do usuário"
              value={inviteEmail}
              onChange={setInviteEmail}
              placeholder="email@exemplo.com"
              type="email"
              format={FIELD_STANDARDS.email.format}
              maxLength={FIELD_STANDARDS.email.maxLength}
              inputMode={FIELD_STANDARDS.email.inputMode}
              validator={FIELD_STANDARDS.email.validate}
            />
          </div>
          <div style={{ minWidth:160 }}>
            <FInput
              label="Perfil"
              value={inviteRole}
              onChange={setInviteRole}
              options={[
                { v:'admin', l:'Administrador' },
                { v:'gestao', l:'Gestão' },
                { v:'concierge', l:'Concierge' },
                { v:'equipe', l:'Equipe' },
              ]}
            />
          </div>
          <Btn onClick={invite} disabled={inviting || !inviteEmail.trim()}>
            {inviting ? 'Adicionando...' : 'Adicionar'}
          </Btn>
        </div>
        {teamError ? <div style={{ marginTop:10 }}><Feedback color={C.red} text={teamError} /></div> : null}
        {teamMessage ? <div style={{ marginTop:10 }}><Feedback color={C.green} text={teamMessage} /></div> : null}
      </SectionCard>

      <SectionCard title="Membros da clínica" subtitle="Gerencie os colaboradores que têm acesso à plataforma.">
        {showOrgChart && !loadingMembers && members.length > 0 && (
          <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap' }}>
            <Btn variant={teamView === 'lista' ? 'primary' : 'ghost'} onClick={() => setTeamView('lista')}>Lista</Btn>
            <Btn variant={teamView === 'organograma' ? 'primary' : 'ghost'} onClick={() => setTeamView('organograma')}>Organograma</Btn>
          </div>
        )}
        {showOrgChart && teamView === 'organograma' && !loadingMembers && members.length > 0 ? (
          <TeamOrgChart
            members={members}
            ownerId={ownerId}
            onSelectMember={id => { setHighlightedMember(id); setTeamView('lista') }}
          />
        ) : loadingMembers ? (
          <div style={{ color:C.textSub, fontSize:14 }}>Carregando membros...</div>
        ) : members.length === 0 ? (
          <div style={{ color:C.textDim, fontSize:14 }}>Nenhum membro adicionado ainda.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {members.map(m => (
              <div key={m.id} data-testid={`team-member-${m.id}`} style={{ display:'grid', gap:12, padding:'12px 14px', borderRadius:14, border:`1px solid ${highlightedMember === m.id ? C.accent : C.border}`, background:C.bg }}>
                <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                  <div style={{ flex:1, minWidth:180 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{mask.name(m.professional_name) || mask.email(m.member_email) || '—'}</div>
                    <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>
                      {ROLE_LABELS[m.role]}
                      {m.readOnly && <span style={{ color:C.accent, fontWeight:800, marginLeft:7 }}>· DONA DA CLÍNICA</span>}
                    </div>
                    {m.readOnly && m.professional_name && m.member_email && <div style={{ fontSize:11, color:C.textDim, marginTop:2 }}>{mask.email(m.member_email)}</div>}
                  </div>
                  {m.readOnly ? (
                    <span style={{ color:C.textDim, fontSize:11.5, maxWidth:300, lineHeight:1.5 }}>
                      Quem criou a clínica. O perfil e o acesso dela não são editáveis aqui — ela ajusta a própria identidade profissional na aba Perfil.
                    </span>
                  ) : (<>
                  <select
                    value={m.role}
                    onChange={e => changeRole(m.id, e.target.value)}
                    style={{ padding:'6px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:C.surface, color:C.text, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}
                  >
                    <option value="admin">Administrador</option>
                    <option value="gestao">Gestão</option>
                    <option value="concierge">Concierge</option>
                    <option value="equipe">Equipe</option>
                  </select>
                  <Btn variant="ghost" onClick={() => removeMember(m.id)}>Remover</Btn>
                  </>)}
                </div>
                {!m.readOnly && <label style={{ display:'flex', gap:9, alignItems:'center', color:C.text, fontSize:12, fontWeight:700 }}>
                  <input
                    type="checkbox"
                    checked={m.clinical_access === true}
                    onChange={event => updateClinicalIdentity(m.id, { clinical_access:event.target.checked })}
                  />
                  Acesso ao prontuário clínico
                </label>}
                {!m.readOnly && m.clinical_access && (
                  <div style={{ color:C.textSub, fontSize:11.5, lineHeight:1.6, marginTop:-2 }}>
                    <strong style={{ color:C.text }}>Identidade profissional (opcional).</strong> Só é necessária para <strong>assinar evolução clínica e emitir receita</strong>. Sem ela, esta pessoa registra anamnese, pré-anamnese, fotos, plano e retorno normalmente, e os registros ficam no nome da conta, marcados como registro da equipe.
                  </div>
                )}
                {!m.readOnly && m.clinical_access && (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:10 }}>
                    <input
                      value={m.professional_name || ''}
                      onChange={event => setMembers(prev => prev.map(row => row.id === m.id ? { ...row, professional_name:event.target.value } : row))}
                      onBlur={event => updateClinicalIdentity(m.id, { professional_name:event.target.value.trim() || null })}
                      placeholder="Nome profissional"
                      style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:C.surface, color:C.text }}
                    />
                    <select
                      aria-label={`Conselho profissional de ${m.professional_name || m.member_email}`}
                      value={m.professional_council || 'CRM'}
                      onChange={event => {
                        const parsed = parseProfessionalRegistration(m.professional_registration)
                        updateClinicalIdentity(m.id, {
                          professional_council:event.target.value,
                          professional_registration:buildProfessionalRegistration(event.target.value, parsed.state, parsed.number) || null,
                        })
                      }}
                      style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:C.surface, color:C.text }}
                    >
                      {['CRM','CRO','CRP','COREN','CRF','CRN','CRBM','CREFITO','CREFONO'].map(council => <option key={council} value={council}>{council}</option>)}
                    </select>
                    <select
                      aria-label={`UF do registro de ${m.professional_name || m.member_email}`}
                      value={parseProfessionalRegistration(m.professional_registration).state}
                      onChange={event => {
                        const parsed = parseProfessionalRegistration(m.professional_registration)
                        updateClinicalIdentity(m.id, { professional_registration:buildProfessionalRegistration(m.professional_council || 'CRM', event.target.value, parsed.number) || null })
                      }}
                      style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:C.surface, color:C.text }}
                    >
                      <option value="">UF do registro</option>
                      {BRAZIL_STATES.map(state => <option key={state} value={state}>{state}</option>)}
                    </select>
                    <input
                      aria-label={`Número do registro de ${m.professional_name || m.member_email}`}
                      inputMode="numeric"
                      maxLength={10}
                      value={parseProfessionalRegistration(m.professional_registration).number}
                      onChange={event => {
                        const parsed = parseProfessionalRegistration(m.professional_registration)
                        const professional_registration = buildProfessionalRegistration(m.professional_council || 'CRM', parsed.state, event.target.value)
                        setMembers(prev => prev.map(row => row.id === m.id ? { ...row, professional_registration } : row))
                      }}
                      onBlur={event => {
                        const parsed = parseProfessionalRegistration(m.professional_registration)
                        updateClinicalIdentity(m.id, { professional_registration:buildProfessionalRegistration(m.professional_council || 'CRM', parsed.state, event.target.value) || null })
                      }}
                      placeholder="Número do registro"
                      style={{ padding:'8px 10px', borderRadius:8, border:`1px solid ${C.border}`, background:C.surface, color:C.text }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// Organograma da equipe. Somente leitura de propósito: editar continua na lista, para não existir
// um segundo caminho de escrita sobre as mesmas permissões. Clicar num card leva para a lista.
function TeamOrgChart({ members, ownerId, onSelectMember }) {
  const mask = useMask()
  const chart = buildClinicOrgChart(members, ownerId)
  const roleTone = { admin:C.accent, gestao:C.cyan || C.accentLight, concierge:C.yellow, equipe:C.textSub }

  const card = (member, highlight) => (
    <button
      key={member.id}
      type="button"
      onClick={() => onSelectMember?.(member.id)}
      title="Ver e editar na lista"
      style={{
        textAlign:'left', cursor:'pointer', fontFamily:'inherit', width:'100%',
        padding:'12px 14px', borderRadius:14, background:C.bg,
        border:`1px solid ${highlight ? C.accent + '66' : C.border}`,
        boxShadow:highlight ? `0 0 0 1px ${C.accent}22` : 'none',
      }}
    >
      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
        <span style={{ color:C.text, fontWeight:700, fontSize:13, overflowWrap:'anywhere' }}>{mask.name(member.name)}</span>
        {member.isOwner && <span style={{ fontSize:9.5, fontWeight:800, letterSpacing:'0.06em', color:C.accent, border:`1px solid ${C.accent}55`, background:`${C.accent}12`, borderRadius:999, padding:'2px 7px' }}>DONA DA CLÍNICA</span>}
      </div>
      <div style={{ color:roleTone[member.role] || C.textSub, fontSize:11, fontWeight:700, marginTop:3 }}>{member.roleLabel}</div>
      {member.email && member.email !== member.name && <div style={{ color:C.textDim, fontSize:10.5, marginTop:2, overflowWrap:'anywhere' }}>{mask.email(member.email)}</div>}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:7 }}>
        {member.capabilities.record
          ? <span style={{ fontSize:10, fontWeight:700, color:C.green, border:`1px solid ${C.green}44`, background:`${C.green}10`, borderRadius:999, padding:'2px 7px' }}>prontuário</span>
          : <span style={{ fontSize:10, fontWeight:700, color:C.textDim, border:`1px solid ${C.border}`, borderRadius:999, padding:'2px 7px' }}>sem prontuário</span>}
        {member.capabilities.sign && <span style={{ fontSize:10, fontWeight:700, color:C.accentLight, border:`1px solid ${C.accentLight}44`, background:`${C.accentLight}10`, borderRadius:999, padding:'2px 7px' }}>assina · {member.council} {member.registration}</span>}
      </div>
    </button>
  )

  if (!chart.total) return <div style={{ color:C.textDim, fontSize:14 }}>Nenhum membro adicionado ainda.</div>

  return (
    <div data-testid="team-org-chart" style={{ display:'grid', gap:14 }}>
      <div style={{ color:C.textSub, fontSize:12 }}>
        {chart.total} pessoa(s) · <strong style={{ color:C.green }}>{chart.summary.withRecordAccess}</strong> com prontuário · <strong style={{ color:C.accentLight }}>{chart.summary.canSign}</strong> podem assinar
      </div>

      {chart.owner && <div style={{ maxWidth:340, margin:'0 auto', width:'100%' }}>{card(chart.owner, true)}</div>}
      {chart.owner && chart.groups.length > 0 && <div aria-hidden="true" style={{ height:14, borderLeft:`1px solid ${C.border}`, margin:'0 auto', width:0 }} />}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(230px, 1fr))', gap:12, alignItems:'start' }}>
        {chart.groups.map(group => (
          <div key={group.role} style={{ display:'grid', gap:8, padding:12, borderRadius:16, border:`1px dashed ${C.border}` }}>
            <div style={{ color:C.textDim, fontSize:10.5, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>
              {group.label} · {group.members.length}
            </div>
            {group.members.map(member => card(member, false))}
          </div>
        ))}
      </div>

      <div style={{ color:C.textDim, fontSize:11, lineHeight:1.6 }}>
        A hierarquia segue o perfil de acesso de cada pessoa, mantido pelo próprio sistema. Clique em alguém para editar na lista.
      </div>
    </div>
  )
}

function SectionCard({ title, subtitle, children }) {
  return (
    <div style={{ padding:20, borderRadius:20, border:`1px solid ${C.border}`, background:C.surface }}>
      <div style={{ marginBottom:16 }}>
        <div style={{ color:C.text, fontWeight:800, fontSize:18 }}>{title}</div>
        <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6, marginTop:6 }}>{subtitle}</div>
      </div>
      {children}
    </div>
  )
}

function Grid({ children }) {
  return <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:14 }}>{children}</div>
}

function MiniStatus({ label, value }) {
  return (
    <div style={{ padding:'10px 12px', borderRadius:14, border:`1px solid ${C.border}`, background:C.surface }}>
      <div style={{ color:C.textDim, fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:4 }}>{label}</div>
      <div style={{ color:C.text, fontWeight:800 }}>{value}</div>
    </div>
  )
}

function Feedback({ color, text }) {
  return <div style={{ padding:'12px 14px', borderRadius:14, border:`1px solid ${color}33`, background:color + '14', color, fontSize:13 }}>{text}</div>
}

function mergeProfile(profile) {
  const registration = parseProfessionalRegistration(profile?.doctor?.registrationId)
  return {
    doctor:{
      ...EMPTY_PROFILE.doctor,
      ...(profile?.doctor || {}),
      registrationState:registration.state,
      registrationNumber:registration.number,
    },
    clinic:{
      ...EMPTY_PROFILE.clinic,
      ...(profile?.clinic || {}),
    },
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Nao foi possivel ler a imagem.'))
    reader.readAsDataURL(file)
  })
}
