import { useCallback, useEffect, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { Btn } from './UI.jsx'
import { fetchBillingStatus } from '../lib/billingClient.js'

export function IntegrationHealth({ google }) {
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState([])
  const [checkedAt, setCheckedAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [whatsapp, meta, billing] = await Promise.all([
      supabase.from('whatsapp_numbers').select('id, label, active').order('created_at'),
      supabase.from('meta_connections').select('status, page_id, ad_account_id').maybeSingle(),
      fetchBillingStatus().catch(error => ({ error })),
    ])
    const activeNumbers = (whatsapp.data || []).filter(item => item.active)
    setHealth([
      { name:'WhatsApp', ok:activeNumbers.length > 0 && !whatsapp.error, detail:activeNumbers.length ? `${activeNumbers.length} número(s) ativo(s)` : 'Nenhum número ativo', action:'whatsapp' },
      { name:'Meta Ads', ok:['configurado','conectado'].includes(meta.data?.status) && !meta.error, detail:meta.data?.status === 'conectado' ? 'Conexão validada' : meta.data?.status === 'configurado' ? 'Credenciais salvas; validação pendente' : 'Não configurado', action:'meta' },
      { name:'Google Agenda', ok:Boolean(google?.status?.connected), detail:google?.status?.connected ? (google.status.email || 'Conectada') : google?.status?.configured ? 'Disponível para conectar' : 'Credenciais do servidor ausentes' },
      { name:'Banco / conciliação', ok:true, detail:'Importação local OFX, CSV e PDF do BRB; nenhum provedor externo' },
      { name:'Cobranças', ok:billing.connection?.status === 'connected' && billing.connection?.webhookConfigured, detail:billing.connection?.status === 'connected' ? `${billing.connection.provider === 'asaas' ? 'Asaas' : billing.connection.provider === 'direct_bank' ? 'Banco direto' : 'Provedor'} · ${billing.connection.environment === 'production' ? 'Produção' : 'Sandbox'} · webhook ${billing.connection.webhookConfigured ? 'ativo' : 'pendente'}` : 'Nenhum provedor configurado' },
    ])
    setCheckedAt(new Date())
    setLoading(false)
  }, [google])
  useEffect(() => { load() }, [load])

  return <div style={{ display:'grid', gap:14 }}>
    <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center' }}><div><h3 style={{ margin:0, color:C.text, fontSize:21 }}>Saúde das integrações</h3><p style={{ margin:'6px 0 0', color:C.textSub, fontSize:13 }}>Visão segura de configuração e disponibilidade, sem exibir tokens.</p></div><Btn variant="ghost" onClick={load} disabled={loading}>{loading ? 'Verificando…' : 'Verificar agora'}</Btn></div>
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))', gap:12 }}>{health.map(item => <div key={item.name} style={{ padding:16, borderRadius:14, border:`1px solid ${item.ok ? C.green + '44' : C.yellow + '55'}`, background:C.surface }}><div style={{ display:'flex', alignItems:'center', gap:8 }}><span style={{ width:9, height:9, borderRadius:'50%', background:item.ok ? C.green : C.yellow }} /><strong style={{ color:C.text, fontSize:14 }}>{item.name}</strong></div><div style={{ marginTop:8, color:C.textSub, fontSize:12, lineHeight:1.5 }}>{item.detail}</div></div>)}</div>
    {checkedAt && <div style={{ color:C.textDim, fontSize:11 }}>Última verificação: {checkedAt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}</div>}
  </div>
}
