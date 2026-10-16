import { useEffect, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Btn, FInput } from './UI.jsx'

// Config (admin) das automações de saída de WhatsApp: lembrete e follow-up.
// O disparo roda no servidor (cron diário); aqui só administramos toggles, templates e timing.
const DEFAULTS = {
  whatsapp_number_id: '',
  reminder_enabled: false,
  reminder_days_before: 1,
  reminder_template: 'Olá {patient_name}! Passando para lembrar do seu atendimento no dia {date}. Qualquer dúvida, é só chamar por aqui. 😊',
  followup_enabled: false,
  followup_days_after: 2,
  followup_template: 'Olá {patient_name}! Como você está depois da sua consulta? Se tiver qualquer dúvida, estamos à disposição. 🌿',
  payment_enabled: false,
  payment_offset_days: 0,
  payment_template: 'Olá {patient_name}! Sua cobrança de {value} vence em {date}. Pague por aqui: {payment_link}',
  anamnese_enabled: false,
  anamnese_days_before: 2,
  anamnese_link: '',
  anamnese_template: 'Olá {patient_name}! Antes da sua consulta no dia {date}, por favor preencha sua ficha de anamnese: {link}',
}

export function WhatsAppAutomations() {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id

  const [cfg, setCfg] = useState(null)
  const [numbers, setNumbers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    const [aRes, nRes] = await Promise.all([
      supabase.from('whatsapp_automations')
        .select('whatsapp_number_id, reminder_enabled, reminder_days_before, reminder_template, followup_enabled, followup_days_after, followup_template, payment_enabled, payment_offset_days, payment_template, anamnese_enabled, anamnese_days_before, anamnese_link, anamnese_template')
        .maybeSingle(),
      supabase.from('whatsapp_numbers').select('id, label, phone').order('created_at', { ascending: true }),
    ])
    if (aRes.error) { setError(aRes.error.message); setLoading(false); return }
    setCfg({ ...DEFAULTS, ...(aRes.data || {}), whatsapp_number_id: aRes.data?.whatsapp_number_id || '' })
    setNumbers(nRes.data ?? [])
    setLoading(false)
  }
  useEffect(() => { if (effectiveUserId) load() }, [effectiveUserId])

  const set = (field, value) => { setCfg(c => ({ ...c, [field]: value })); setSavedAt(null) }

  async function save() {
    if (saving) return
    setSaving(true); setError(null)
    const { error: err } = await supabase.from('whatsapp_automations').upsert({
      user_id: effectiveUserId,
      whatsapp_number_id: cfg.whatsapp_number_id || null,
      reminder_enabled: !!cfg.reminder_enabled,
      reminder_days_before: Number(cfg.reminder_days_before) || 0,
      reminder_template: cfg.reminder_template,
      followup_enabled: !!cfg.followup_enabled,
      followup_days_after: Number(cfg.followup_days_after) || 0,
      followup_template: cfg.followup_template,
      payment_enabled: !!cfg.payment_enabled,
      payment_offset_days: Number(cfg.payment_offset_days) || 0,
      payment_template: cfg.payment_template,
      anamnese_enabled: !!cfg.anamnese_enabled,
      anamnese_days_before: Number(cfg.anamnese_days_before) || 0,
      anamnese_link: (cfg.anamnese_link || '').trim(),
      anamnese_template: cfg.anamnese_template,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    setSaving(false)
    if (err) { setError(err.message); return }
    setSavedAt(Date.now())
  }

  if (loading) return <div style={{ color: C.textSub, fontSize: 13, padding: 20 }}>Carregando automações…</div>

  const numberOptions = [
    { v: '', l: numbers.length ? 'Escolha um número…' : 'Nenhum número cadastrado' },
    ...numbers.map(n => ({ v: n.id, l: n.label ? `${n.label} (${n.phone || 's/ número'})` : (n.phone || n.id) })),
  ]
  const hasNumber = !!cfg.whatsapp_number_id

  const s = {
    intro: { fontSize: 13, color: C.textSub, marginBottom: 16, lineHeight: 1.45 },
    warn: { fontSize: 12, color: C.text, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 16 },
    card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14 },
    head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    name: { fontSize: 14, fontWeight: 700, color: C.text },
    desc: { fontSize: 11.5, color: C.textSub, marginTop: 2, lineHeight: 1.4 },
    body: { marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 },
    label: { fontSize: 11, fontWeight: 600, color: C.textSub, marginBottom: 4, display: 'block' },
    textarea: { width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 11px', fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.4 },
    vars: { fontSize: 10.5, color: C.textDim, marginTop: 4 },
    foot: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 },
    saved: { fontSize: 12, color: C.green || '#16a34a' },
  }

  const Toggle = ({ checked, onChange }) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: C.accent, cursor: 'pointer' }} />
    </label>
  )

  return (
    <div>
      <div style={s.intro}>
        Mensagens automáticas enviadas pelo WhatsApp da clínica. Escolha por qual número enviar,
        ligue cada automação e ajuste o texto. Variáveis disponíveis são substituídas no envio.
      </div>

      <div style={s.card}>
        <FInput label="Número de envio" value={cfg.whatsapp_number_id}
          onChange={v => set('whatsapp_number_id', v)} options={numberOptions} />
        {!hasNumber && (
          <div style={{ ...s.vars, marginTop: 8 }}>
            Sem um número selecionado, nada é enviado — as configurações ficam salvas e prontas.
            Cadastre números em <strong>Configurações → WhatsApp</strong>.
          </div>
        )}
      </div>

      {error && <div style={{ color: C.red || '#ef4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}

      {/* Lembrete */}
      <div style={s.card}>
        <div style={s.head}>
          <div>
            <div style={s.name}>Lembrete de consulta/cirurgia</div>
            <div style={s.desc}>Enviado alguns dias antes do atendimento (consultas e cirurgias).</div>
          </div>
          <Toggle checked={cfg.reminder_enabled} onChange={v => set('reminder_enabled', v)} />
        </div>
        {cfg.reminder_enabled && (
          <div style={s.body}>
            <div style={{ maxWidth: 220 }}>
              <FInput label="Enviar quantos dias antes" type="number"
                value={cfg.reminder_days_before} onChange={v => set('reminder_days_before', v)} />
            </div>
            <div>
              <label style={s.label}>Mensagem</label>
              <textarea rows={3} style={s.textarea} value={cfg.reminder_template}
                onChange={e => set('reminder_template', e.target.value)} />
              <div style={s.vars}>Variáveis: {'{patient_name}'}, {'{date}'}, {'{time}'}</div>
            </div>
          </div>
        )}
      </div>

      {/* Follow-up */}
      <div style={s.card}>
        <div style={s.head}>
          <div>
            <div style={s.name}>Follow-up pós-consulta</div>
            <div style={s.desc}>Enviado alguns dias depois da consulta, para acompanhar o paciente.</div>
          </div>
          <Toggle checked={cfg.followup_enabled} onChange={v => set('followup_enabled', v)} />
        </div>
        {cfg.followup_enabled && (
          <div style={s.body}>
            <div style={{ maxWidth: 220 }}>
              <FInput label="Enviar quantos dias depois" type="number"
                value={cfg.followup_days_after} onChange={v => set('followup_days_after', v)} />
            </div>
            <div>
              <label style={s.label}>Mensagem</label>
              <textarea rows={3} style={s.textarea} value={cfg.followup_template}
                onChange={e => set('followup_template', e.target.value)} />
              <div style={s.vars}>Variáveis: {'{patient_name}'}, {'{date}'}</div>
            </div>
          </div>
        )}
      </div>

      {/* Cobrança no vencimento */}
      <div style={s.card}>
        <div style={s.head}>
          <div>
            <div style={s.name}>Cobrança de pagamento</div>
            <div style={s.desc}>Enviada conforme o <strong>vencimento</strong> da conta a receber, só para quem ainda não pagou.</div>
          </div>
          <Toggle checked={cfg.payment_enabled} onChange={v => set('payment_enabled', v)} />
        </div>
        {cfg.payment_enabled && (
          <div style={s.body}>
            <div style={{ maxWidth: 260 }}>
              <FInput label="Dias após o vencimento (0 = no dia)" type="number"
                value={cfg.payment_offset_days} onChange={v => set('payment_offset_days', v)} />
            </div>
            <div>
              <label style={s.label}>Mensagem</label>
              <textarea rows={3} style={s.textarea} value={cfg.payment_template}
                onChange={e => set('payment_template', e.target.value)} />
              <div style={{ color:C.textDim, fontSize:11, lineHeight:1.5 }}>Variáveis: {'{patient_name}'}, {'{value}'}, {'{date}'}, {'{payment_link}'}, {'{pix_code}'}, {'{payment_type}'}. Só cobranças Asaas pendentes ou vencidas são enviadas; a régua para após a confirmação do pagamento.</div>
              <div style={s.vars}>Variáveis: {'{patient_name}'}, {'{value}'}, {'{date}'} (vencimento)</div>
            </div>
          </div>
        )}
      </div>

      {/* Link de anamnese */}
      <div style={s.card}>
        <div style={s.head}>
          <div>
            <div style={s.name}>Link de anamnese</div>
            <div style={s.desc}>Enviado antes da consulta com o link para o paciente preencher a ficha de anamnese.</div>
          </div>
          <Toggle checked={cfg.anamnese_enabled} onChange={v => set('anamnese_enabled', v)} />
        </div>
        {cfg.anamnese_enabled && (
          <div style={s.body}>
            <div style={{ maxWidth: 220 }}>
              <FInput label="Enviar quantos dias antes" type="number"
                value={cfg.anamnese_days_before} onChange={v => set('anamnese_days_before', v)} />
            </div>
            <FInput label="Link do formulário de anamnese"
              value={cfg.anamnese_link} onChange={v => set('anamnese_link', v)}
              placeholder="https://…" />
            {!cfg.anamnese_link?.trim() && (
              <div style={s.vars}>Sem um link preenchido, esta automação não envia (fica salva e pronta).</div>
            )}
            <div>
              <label style={s.label}>Mensagem</label>
              <textarea rows={3} style={s.textarea} value={cfg.anamnese_template}
                onChange={e => set('anamnese_template', e.target.value)} />
              <div style={s.vars}>Variáveis: {'{patient_name}'}, {'{date}'}, {'{link}'}</div>
            </div>
          </div>
        )}
      </div>

      <div style={s.foot}>
        <Btn onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar automações'}</Btn>
        {savedAt && <span style={s.saved}>Salvo ✓</span>}
      </div>
    </div>
  )
}
