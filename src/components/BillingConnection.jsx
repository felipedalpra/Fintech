import { useEffect, useState } from 'react'
import { C } from '../theme.js'
import { Btn, Card, FInput } from './UI.jsx'
import { connectBillingProvider, fetchBillingStatus } from '../lib/billingClient.js'

export function BillingConnection() {
  const [status, setStatus] = useState(null)
  const [environment, setEnvironment] = useState('sandbox')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const providers = status?.providers || []
  const directBank = providers.find(item => item.id === 'direct_bank')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const result = await fetchBillingStatus()
      setStatus(result)
      if (result.connection?.environment) setEnvironment(result.connection.environment)
    } catch (nextError) { setError(nextError.message) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!apiKey.trim()) { setError('Informe a chave da API Asaas.'); return }
    setSaving(true); setError(''); setMessage('')
    try {
      await connectBillingProvider({ provider:'asaas', environment, apiKey:apiKey.trim() })
      setApiKey('')
      setMessage('Conta validada e webhook configurado automaticamente.')
      await load()
    } catch (nextError) { setError(nextError.message) }
    finally { setSaving(false) }
  }

  return <div style={{ display:'grid', gap:18 }}>
    <div>
      <h3 style={{ margin:0, color:C.text, fontSize:21 }}>Cobranças e banco</h3>
      <p style={{ margin:'7px 0 0', color:C.textSub, fontSize:13, lineHeight:1.6 }}>Emita boleto e Pix com valor e vencimento vindos do razão. A conexão ativa pode ser trocada por um banco homologado sem criar um financeiro paralelo.</p>
    </div>
    <Card style={{ padding:18, background:C.surface }}>
      {loading ? <div style={{ color:C.textSub }}>Verificando conexão…</div> : <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
        <span style={{ width:10, height:10, borderRadius:'50%', background:status?.connection?.status === 'connected' ? C.green : C.yellow }} />
        <strong style={{ color:C.text }}>{status?.configured ? 'Asaas conectado' : 'Asaas não configurado'}</strong>
        {status?.connection && <span style={{ color:C.textSub, fontSize:12 }}>{status.connection.environment === 'production' ? 'Produção' : 'Sandbox'} · chave final {status.connection.apiKeyLast4 || '—'} · webhook {status.connection.webhookConfigured ? 'ativo' : 'pendente'}</span>}
      </div>}
    </Card>
    <Card style={{ padding:18, background:C.surface }}>
      <strong style={{ color:C.text }}>Banco direto</strong>
      <div style={{ marginTop:7, color:C.textSub, fontSize:13, lineHeight:1.55 }}>{directBank?.unavailableReason || 'Aguardando a definição do banco e a homologação da API.'}</div>
      <div style={{ marginTop:9, color:C.textDim, fontSize:12 }}>Base preparada para Pix, boleto, consulta, cancelamento, webhook, estorno, tarifas e sincronização de extrato. Nenhuma conexão bancária será simulada antes das credenciais reais.</div>
    </Card>
    <div style={{ display:'grid', gridTemplateColumns:'minmax(180px,240px) minmax(260px,1fr)', gap:14 }}>
      <FInput label="Ambiente" value={environment} onChange={setEnvironment} options={[{ v:'sandbox', l:'Sandbox (testes)' }, { v:'production', l:'Produção' }]} />
      <FInput label="Chave da API Asaas" type="password" value={apiKey} onChange={setApiKey} placeholder={status?.configured ? 'Informe uma nova chave para substituir' : '$aact_…'} />
    </div>
    <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
      <Btn onClick={save} disabled={saving}>{saving ? 'Validando…' : status?.configured ? 'Atualizar conexão' : 'Conectar Asaas'}</Btn>
      <span style={{ color:C.textDim, fontSize:12 }}>Ao salvar, o sistema valida a conta e cadastra o endpoint de webhook.</span>
    </div>
    {message && <div style={{ color:C.green, fontSize:13, fontWeight:600 }}>{message}</div>}
    {error && <div style={{ color:C.red, fontSize:13, fontWeight:600 }}>{error}</div>}
  </div>
}
