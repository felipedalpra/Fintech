import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { Btn, Card, FInput } from './UI.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { fetchSecureProfile, saveSecureProfile } from '../lib/secureProfileClient.js'

const EMPTY_PROFILE = {
  doctor:{
    fullName:'',
    professionalTitle:'Cirurgião plástico',
    specialty:'',
    registrationId:'',
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

export function Settings() {
  const { mode, setTheme } = useTheme()
  const isLight = mode === 'light'
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
    doctorFields:Object.values(profile.doctor).filter(Boolean).length,
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

  const save = async () => {
    setSaving(true)
    setError('')
    setMessage('')

    try {
      await saveSecureProfile(profile)
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

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
      <Card style={{ maxWidth:920 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:20, alignItems:'center', flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Visualização</div>
            <h3 style={{ margin:'0 0 8px', fontSize:22, color:C.text, letterSpacing:'-0.03em' }}>Modo da plataforma</h3>
            <p style={{ margin:0, color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:460 }}>
              O SurgiMetrics abre por padrão em modo escuro. Ative a lanterna para usar o modo claro.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setTheme(isLight ? 'dark' : 'light')}
            aria-pressed={isLight}
            style={{
              width:88,
              height:88,
              borderRadius:28,
              border:`1px solid ${isLight ? C.accent : C.border}`,
              background:isLight ? `linear-gradient(180deg, ${C.yellow}22, ${C.accent}22)` : C.surface,
              color:isLight ? C.accent : C.textSub,
              display:'grid',
              placeItems:'center',
              cursor:'pointer',
              boxShadow:isLight ? `0 0 32px ${C.yellow}30` : 'none',
              transition:'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
              fontFamily:'inherit',
            }}
            title={isLight ? 'Desligar modo claro' : 'Ativar modo claro'}
          >
            <div style={{ display:'grid', justifyItems:'center', gap:6 }}>
              <div style={{ fontSize:28, lineHeight:1 }}>🔦</div>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' }}>
                {isLight ? 'Ligada' : 'Desligada'}
              </div>
            </div>
          </button>
        </div>

        <div style={{ marginTop:24, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12 }}>
          <ModeCard title="Modo escuro" active={!isLight} description="Visual padrão da plataforma, com contraste forte para uso prolongado." />
          <ModeCard title="Modo claro" active={isLight} description="Visual mais claro para ambientes iluminados e apresentações." />
        </div>
      </Card>

      <Card style={{ maxWidth:920 }}>
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
            <SectionCard title="Informações do médico" subtitle="Dados pessoais e profissionais.">
              <Grid>
                <FInput label="Nome completo" value={profile.doctor.fullName} onChange={value => updateField('doctor', 'fullName', value)} />
                <FInput label="Título profissional" value={profile.doctor.professionalTitle} onChange={value => updateField('doctor', 'professionalTitle', value)} />
                <FInput label="Especialidade" value={profile.doctor.specialty} onChange={value => updateField('doctor', 'specialty', value)} />
                <FInput label="CRM / RQE" value={profile.doctor.registrationId} onChange={value => updateField('doctor', 'registrationId', value)} />
                <FInput label="Telefone" value={profile.doctor.phone} onChange={value => updateField('doctor', 'phone', value)} />
                <FInput label="E-mail profissional" value={profile.doctor.email} onChange={value => updateField('doctor', 'email', value)} />
              </Grid>
            </SectionCard>

            <SectionCard title="Informações da clínica" subtitle="Dados institucionais para identidade visual, contato e documentos da operação.">
              <Grid>
                <FInput label="Razão social" value={profile.clinic.legalName} onChange={value => updateField('clinic', 'legalName', value)} />
                <FInput label="Nome fantasia" value={profile.clinic.tradeName} onChange={value => updateField('clinic', 'tradeName', value)} />
                <FInput label="CNPJ / Documento" value={profile.clinic.documentId} onChange={value => updateField('clinic', 'documentId', value)} />
                <FInput label="Telefone da clínica" value={profile.clinic.phone} onChange={value => updateField('clinic', 'phone', value)} />
                <FInput label="E-mail da clínica" value={profile.clinic.email} onChange={value => updateField('clinic', 'email', value)} />
                <FInput label="Site" value={profile.clinic.website} onChange={value => updateField('clinic', 'website', value)} />
                <FInput label="Endereço" value={profile.clinic.addressLine} onChange={value => updateField('clinic', 'addressLine', value)} />
                <FInput label="Cidade" value={profile.clinic.city} onChange={value => updateField('clinic', 'city', value)} />
                <FInput label="Estado" value={profile.clinic.state} onChange={value => updateField('clinic', 'state', value)} />
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
      </Card>
    </div>
  )
}

function ModeCard({ title, description, active }) {
  return (
    <div style={{ padding:16, borderRadius:16, border:`1px solid ${active ? C.accent + '55' : C.border}`, background:active ? C.accent + '10' : C.surface }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginBottom:8 }}>
        <div style={{ color:C.text, fontWeight:700 }}>{title}</div>
        <div style={{ width:10, height:10, borderRadius:999, background:active ? C.green : C.textDim }} />
      </div>
      <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6 }}>{description}</div>
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
  return {
    doctor:{
      ...EMPTY_PROFILE.doctor,
      ...(profile?.doctor || {}),
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
