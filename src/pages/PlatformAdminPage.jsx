import { useEffect, useState } from 'react'
import { C } from '../theme.js'
import { Btn, Card, Badge, FInput } from '../components/UI.jsx'
import { fetchPlatformAdminAccounts, setPlatformAdminAccountValue } from '../lib/billingClient.js'

// Ferramenta interna da Zentri Tech (não da clínica): ajustar o preço contratado da
// assinatura SaaS de qualquer clínica, independente do preço padrão do plano. Rota
// separada do app (/zentri-admin), fora do sistema de papéis por clínica — o acesso
// de verdade é checado no backend (ZENTRI_PLATFORM_ADMIN_EMAILS).

export function PlatformAdminPage() {
  const [accounts, setAccounts] = useState(null)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState('')

  const load = () => {
    setError('')
    fetchPlatformAdminAccounts()
      .then(payload => setAccounts(payload.accounts || []))
      .catch(nextError => { setAccounts([]); setError(nextError.message || 'Acesso restrito.') })
  }

  useEffect(load, [])

  const reaisFromCents = cents => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','))

  const saveValue = async account => {
    setSavingId(account.userId)
    setError('')
    try {
      const draft = drafts[account.userId]
      const monthlyValueReais = draft === undefined || draft === ''
        ? null
        : Number(String(draft).replace(',', '.'))
      await setPlatformAdminAccountValue({ userId:account.userId, monthlyValueReais })
      load()
    } catch (nextError) {
      setError(nextError.message || 'Não foi possível salvar o valor.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, padding:'32px 24px', display:'flex', justifyContent:'center' }}>
      <div style={{ width:'100%', maxWidth:960, display:'flex', flexDirection:'column', gap:20 }}>
        <div>
          <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Zentri Tech</div>
          <h1 style={{ margin:'0 0 6px', color:C.text, fontSize:26 }}>Preço contratado por clínica</h1>
          <p style={{ margin:0, color:C.textDim, fontSize:14, lineHeight:1.6, maxWidth:640 }}>
            Ajusta o valor mensal cobrado de uma clínica específica, sobrepondo o preço padrão do plano
            (ex.: preço de entrada enquanto o financeiro ou outra parte da plataforma ainda não está pronta).
            Deixe o campo em branco e salve para voltar ao preço padrão.
          </p>
        </div>

        {error ? <Card style={{ padding:16, border:`1px solid ${C.red}66` }}><div style={{ color:C.red, fontSize:13 }}>{error}</div></Card> : null}

        {accounts === null ? (
          <Card><div style={{ color:C.textSub }}>Carregando...</div></Card>
        ) : accounts.length === 0 && !error ? (
          <Card><div style={{ color:C.textSub }}>Nenhuma clínica com conta de cobrança ainda.</div></Card>
        ) : (
          accounts.map(account => {
            const defaultValue = reaisFromCents(account.defaultMonthlyValueCents)
            const draft = drafts[account.userId] ?? reaisFromCents(account.contractedMonthlyValueCents)
            return (
              <Card key={account.userId} style={{ padding:18 }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', marginBottom:12 }}>
                  <div>
                    <div style={{ color:C.text, fontWeight:700 }}>{account.billingContactName || account.email}</div>
                    <div style={{ color:C.textDim, fontSize:12 }}>{account.email}</div>
                  </div>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <Badge color={account.status === 'active' ? C.green : C.yellow} small>{account.status}</Badge>
                    <Badge color={C.accent} small>{account.provider === 'asaas' ? 'Asaas' : 'Sem gateway'}</Badge>
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:12, alignItems:'end' }}>
                  <FInput
                    label={`Valor mensal (padrão: R$ ${defaultValue || '0,00'})`}
                    type="text"
                    inputMode="decimal"
                    placeholder="Em branco = preço padrão"
                    value={draft}
                    onChange={value => setDrafts(prev => ({ ...prev, [account.userId]:value }))}
                  />
                  <Btn
                    variant="ghost"
                    onClick={() => saveValue(account)}
                    disabled={savingId === account.userId}
                    style={{ justifyContent:'center' }}
                  >
                    {savingId === account.userId ? 'Salvando...' : 'Salvar valor'}
                  </Btn>
                  <div style={{ color:C.textDim, fontSize:12 }}>
                    {account.asaasSubscriptionId ? 'Assinatura ativa no Asaas: o novo valor vale a partir do próximo ciclo.' : 'Ainda sem assinatura criada no Asaas.'}
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
