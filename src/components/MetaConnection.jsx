import { useEffect, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'
import { Btn, FInput } from './UI.jsx'

// Conexão do Meta Ads (admin). O token da página é write-only. App Secret e Verify Token pertencem
// ao app global e ficam exclusivamente nas variáveis de ambiente da Vercel.
const WEBHOOK_URL = 'https://www.surgimetrics.com.br/api/whatsapp?action=meta-webhook'

export function MetaConnection() {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = ownerId || user?.id

  const [cfg, setCfg] = useState(null)
  const [form, setForm] = useState({ ad_account_id: '', page_id: '', access_token: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  async function load() {
    setLoading(true); setError(null)
    // NÃO seleciona access_token/app_secret (SELECT revogado).
    const { data, error: err } = await supabase.from('meta_connections')
      .select('ad_account_id, page_id, status').maybeSingle()
    if (err) { setError(err.message); setLoading(false); return }
    setCfg(data)
    setForm(f => ({ ...f, ad_account_id: data?.ad_account_id || '', page_id: data?.page_id || '' }))
    setLoading(false)
  }
  useEffect(() => { if (effectiveUserId) load() }, [effectiveUserId])

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved(false) }

  async function save() {
    if (saving) return
    setSaving(true); setError(null)
    const hasStoredToken = cfg?.status === 'configurado' || cfg?.status === 'conectado'
    const hasPageToken = Boolean(form.access_token.trim()) || hasStoredToken
    const payload = {
      user_id: effectiveUserId,
      ad_account_id: form.ad_account_id.trim() || null,
      page_id: form.page_id.trim() || null,
      status: (form.page_id.trim() && hasPageToken)
        ? (cfg?.status === 'conectado' ? 'conectado' : 'configurado')
        : 'desconectado',
      updated_at: new Date().toISOString(),
    }
    // Só grava o token se foi digitado (não apaga o existente ao salvar novamente).
    if (form.access_token.trim()) payload.access_token = form.access_token.trim()

    const { error: err } = await supabase.from('meta_connections').upsert(payload, { onConflict: 'user_id' })
    setSaving(false)
    if (err) { setError(err.message); return }
    setForm(f => ({ ...f, access_token: '' })) // limpa o segredo do formulário
    setSaved(true)
    load()
  }

  if (loading) return <div style={{ color: C.textSub, fontSize: 13, padding: 20 }}>Carregando…</div>

  const s = {
    intro: { fontSize: 13, color: C.textSub, marginBottom: 16, lineHeight: 1.45 },
    card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 12 },
    label: { fontSize: 11, fontWeight: 700, color: C.textDim, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4, display: 'block' },
    mono: { fontFamily: 'ui-monospace, monospace', fontSize: 12, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px', color: C.text, wordBreak: 'break-all' },
    note: { fontSize: 11.5, color: C.textDim, lineHeight: 1.5 },
    status: ok => ({ fontSize: 12, fontWeight: 700, color: ok ? (C.green || '#16a34a') : C.textSub }),
  }
  const status = cfg?.status || 'desconectado'
  const statusMeta = {
    conectado: { label: '● Conectado e validado', ok: true },
    configurado: { label: '◐ Configuração salva', ok: false },
    erro: { label: '⚠ Erro de conexão', ok: false },
    desconectado: { label: '○ Aguardando configuração', ok: false },
  }[status] || { label: '○ Aguardando configuração', ok: false }

  return (
    <div>
      <div style={s.intro}>
        Conecte os anúncios do Meta (Facebook/Instagram) da clínica. Os <strong>leads dos formulários
        (Lead Ads) entram automaticamente no funil</strong> em "Primeiro Contato", etiquetados com a
        campanha de origem. (Métricas de campanha e atribuição até a receita vêm nas próximas fases.)
      </div>
      {error && <div style={{ color: C.red || '#ef4444', fontSize: 12, marginBottom: 10 }}>{error}</div>}

      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong style={{ fontSize: 14, color: C.text }}>Credenciais</strong>
          <span style={s.status(statusMeta.ok)}>{statusMeta.label}</span>
        </div>
        <FInput label="Ad Account ID (act_…)" value={form.ad_account_id} onChange={v => set('ad_account_id', v)} placeholder="act_123456789" />
        <FInput label="Page ID (página do Facebook)" value={form.page_id} onChange={v => set('page_id', v)} placeholder="ID da página" />
        <div>
          <label style={s.label}>Access token da página (write-only)</label>
          <input type="password" value={form.access_token} onChange={e => set('access_token', e.target.value)}
            placeholder={cfg ? '•••• (deixe em branco para manter)' : 'colar token'} style={{ ...s.mono, width: '100%', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Btn onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar conexão'}</Btn>
          {saved && <span style={{ fontSize: 12, color: C.green || '#16a34a' }}>Salvo ✓</span>}
        </div>
      </div>

      <div style={s.card}>
        <strong style={{ fontSize: 14, color: C.text }}>Webhook (configurar no app do Meta)</strong>
        <div>
          <label style={s.label}>URL de callback</label>
          <div style={s.mono}>{WEBHOOK_URL}</div>
        </div>
        <div style={s.note}>
          No Meta for Developers → seu app → Webhooks → objeto <strong>Page</strong>, campo
          <strong> leadgen</strong>: use a URL acima. O Verify Token e o App Secret ficam somente
          no servidor e serão configurados na Vercel, nunca nesta tela.
          ⚠️ Ler leads reais exige <strong>App Review + Verificação de Negócio</strong> no Meta
          (permissões <code>leads_retrieval</code> e <code>ads_read</code>) — processo de semanas; inicie em paralelo.
        </div>
      </div>

      <div style={s.card}>
        <strong style={{ fontSize: 14, color: C.text }}>Ativação futura no servidor</strong>
        <div style={s.note}>
          A estrutura está preparada. Para ativar, cadastre na Vercel as variáveis
          <code> META_VERIFY_TOKEN</code>, <code> META_APP_SECRET</code> e
          <code> META_GRAPH_VERSION</code>, conclua a revisão do app e valide a assinatura do webhook.
          Enquanto isso não acontecer, “Configuração salva” não será apresentada como conexão validada.
        </div>
      </div>
    </div>
  )
}
