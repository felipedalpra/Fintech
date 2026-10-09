# Emissão de Boletos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emitir boletos bancários diretamente do sistema para cobranças de cirurgias e consultas, com **registro automático** no banco e **baixa automática** de pagamento — sem precisar entrar no sistema do banco manualmente.

**Pré-requisito:** O plano `2026-10-08-whatsapp-crm.md` é opcional mas recomendado para a cobrança automática via WhatsApp.

**Architecture:** Interface abstrata (`api/_lib/billingClient.js`) isola o provider escolhido (Asaas, Iugu, etc.). O frontend dispara a emissão via `api/billing/charge.js`. O provider notifica o pagamento via webhook em `api/billing/webhook.js`, que atualiza o `payment_status` do lançamento no Supabase. Nenhuma chave do provider fica no frontend.

**Provider:** Abstrato — configurar `BILLING_PROVIDER_URL` e `BILLING_API_KEY` nas env vars. O código documenta claramente onde adaptar para cada provider.

**Tech Stack:** React 18, Supabase, Vercel serverless

---

## ⚠️ Decisão arquitetural obrigatória antes de implementar

Existem dois caminhos para registro automático + baixa automática. A clínica precisa decidir antes de começar.

### Caminho A — Via gateway de pagamento (Asaas, Iugu, EFÍ/Gerencianet) ← **spec atual**

O gateway emite o boleto, faz o registro no banco e notifica o pagamento via webhook. A clínica não precisa de certificado digital e não interage com o banco diretamente.

| Item | Detalhe |
|------|---------|
| Certificado digital | ❌ Não precisa |
| Registro automático | ✅ Feito pelo gateway |
| Baixa automática | ✅ Via webhook (já no spec) |
| Custo por boleto | R$ 1–3 por boleto emitido (varia por gateway) |
| Complexidade | Baixa — só configurar chave de API e URL do webhook |
| Prazo | 1–3 dias para ativar conta no gateway |

**Gateways recomendados (do mais simples ao mais completo):**
- **Asaas** — cadastro PJ, API REST bem documentada, sandbox gratuito, webhook testável no painel
- **EFÍ (ex-Gerencianet)** — menor custo por boleto, boa API, suporte a PIX
- **Iugu** — mais robusto, ideal se precisar de split de pagamento no futuro

### Caminho B — Integração direta com o banco (sem gateway)

O sistema se comunica diretamente com a API do banco da clínica (BB, Bradesco, Itaú, Caixa, Sicoob, etc.). Requer autenticação mútua com certificado digital.

| Item | Detalhe |
|------|---------|
| Certificado digital | ✅ **Obrigatório** — e-CNPJ A1 (tipo "A1", arquivo `.pfx` ou `.p12`) |
| Quem emite o certificado | Autoridade Certificadora credenciada (Serasa, Certisign, Valid, etc.) |
| Validade | 1 ano (A1) — precisa renovar anualmente |
| Custo do certificado | R$ 200–400/ano |
| Registro automático | ✅ Via API bancária (ex: Cobrança Registrada do BB, API Boleto Híbrido Bradesco) |
| Baixa automática | ✅ Via webhook/polling da API bancária |
| Complexidade | Alta — cada banco tem API diferente, autenticação OAuth 2.0 + mTLS |
| Prazo | 2–4 semanas (tempo de emissão do certificado + cadastro na API do banco) |

**Pré-requisitos para o Caminho B:**
1. Conta PJ no banco com acesso à API de cobrança (solicitar ao gerente)
2. Certificado e-CNPJ A1 no nome do CNPJ da clínica — **não** no nome da Dra. Vitoria como CPF
3. Ambiente de homologação/sandbox disponibilizado pelo banco
4. Credenciais OAuth do banco (client_id + client_secret)

> **Recomendação:** Para o volume de uma clínica pequena (< 100 boletos/mês), o Caminho A via Asaas tem custo menor, zero burocracia de certificado e implementação em dias. O certificado só se justifica se a clínica já tiver volume alto ou quiser eliminar taxas por boleto no longo prazo.

**Ação necessária:** Confirmar com a Dra. Vitoria / Augusto qual caminho seguir antes de qualquer implementação. Se Caminho B, confirmar também com qual banco e solicitar acesso à API.

---

---

## Referências obrigatórias

- `api/_lib/whatsappClient.js` — padrão de cliente HTTP abstrato a seguir
- `api/financial-assistant.js` — padrão de auth serverless
- `supabase/erp_relational_schema.sql` — tabelas `surgeries` e `consultations`
- `src/components/Patients.jsx` — drawer onde o botão de cobrança aparece
- `src/theme.js` — tokens de cor

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/billing_charges_schema.sql` | Criar | Tabela `charges` para rastrear cobranças emitidas |
| `api/_lib/billingClient.js` | Criar | Cliente HTTP abstrato para o provider |
| `api/billing/charge.js` | Criar | Endpoint: emitir cobrança (boleto/PIX) |
| `api/billing/webhook.js` | Criar | Endpoint: receber confirmação de pagamento |
| `src/components/ChargeButton.jsx` | Criar | Botão de emissão reutilizável |
| `vercel.json` | Modificar | Registrar rotas da API |

---

## Task 1: Schema SQL

**Files:**
- Create: `supabase/billing_charges_schema.sql`

- [ ] **Step 1.1: Criar migração**

```sql
-- billing_charges_schema.sql

create table if not exists public.charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,

  -- Referência ao lançamento de origem (uma das duas, nunca ambas).
  surgery_id uuid references public.surgeries(id) on delete set null,
  consultation_id uuid references public.consultations(id) on delete set null,

  -- Dados da cobrança.
  amount numeric(10,2) not null,
  description text not null,
  due_date date not null,

  -- Status e rastreio.
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'overdue', 'cancelled')),
  provider_charge_id text,         -- ID retornado pelo provider
  payment_link text,               -- link para o cliente pagar
  boleto_barcode text,             -- código de barras do boleto
  boleto_pdf_url text,             -- URL do PDF do boleto
  paid_at timestamptz,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.charges enable row level security;

do $$ begin
  begin
    create policy "Charges own rows" on public.charges
      for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;

create index if not exists idx_charges_patient on public.charges(patient_id, created_at desc);
create index if not exists idx_charges_provider_id on public.charges(provider_charge_id);
```

- [ ] **Step 1.2: Aplicar no Supabase**

Executar no SQL Editor.

---

## Task 2: Cliente HTTP abstrato

**Files:**
- Create: `api/_lib/billingClient.js`

- [ ] **Step 2.1: Criar cliente**

```js
// api/_lib/billingClient.js
// Interface abstrata para providers de cobrança.
// Configurar via env vars:
//   BILLING_PROVIDER_URL   — ex: https://www.asaas.com/api/v3
//   BILLING_API_KEY        — Access Token do provider
//
// Payload normalizado para Asaas.
// Para Iugu: adaptar o campo "customer" e o endpoint.

export async function createCharge({ customerId, amount, description, dueDate, customerData }) {
  const baseUrl = process.env.BILLING_PROVIDER_URL
  const apiKey  = process.env.BILLING_API_KEY

  if (!baseUrl || !apiKey) throw new Error('Billing provider não configurado.')

  // Passo 1: criar/buscar cliente no provider.
  let providerCustomerId = customerId
  if (!providerCustomerId && customerData) {
    providerCustomerId = await ensureCustomer(baseUrl, apiKey, customerData)
  }

  // Passo 2: criar cobrança.
  const body = JSON.stringify({
    customer:    providerCustomerId,
    billingType: 'BOLETO',        // ou 'PIX' | 'UNDEFINED' (Asaas aceita todos)
    value:       amount,
    dueDate:     dueDate,         // YYYY-MM-DD
    description: description,
  })

  const res = await fetch(`${baseUrl}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', access_token: apiKey },
    body,
  })

  if (!res.ok) throw new Error(`Billing error: ${await res.text()}`)

  const data = await res.json()

  // Normalizar resposta para nosso formato interno.
  return {
    providerChargeId: data.id,
    paymentLink:      data.invoiceUrl  ?? data.bankSlipUrl ?? null,
    boletoBarcode:    data.nossoNumero ?? null,
    boletoPdfUrl:     data.bankSlipUrl ?? null,
    status:           normalizeStatus(data.status),
  }
}

async function ensureCustomer(baseUrl, apiKey, { name, cpf, email, phone }) {
  const res = await fetch(`${baseUrl}/customers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', access_token: apiKey },
    body: JSON.stringify({ name, cpfCnpj: cpf?.replace(/\D/g, ''), email, phone }),
  })
  if (!res.ok) throw new Error(`Customer creation failed: ${await res.text()}`)
  const data = await res.json()
  return data.id
}

function normalizeStatus(providerStatus) {
  const map = {
    PENDING:    'pending',
    RECEIVED:   'paid',
    CONFIRMED:  'paid',
    OVERDUE:    'overdue',
    CANCELLED:  'cancelled',
    REFUNDED:   'cancelled',
  }
  return map[providerStatus] ?? 'pending'
}
```

---

## Task 3: Endpoint de emissão

**Files:**
- Create: `api/billing/charge.js`

- [ ] **Step 3.1: Criar endpoint**

```js
// api/billing/charge.js
import { createClient } from '@supabase/supabase-js'
import { createCharge } from '../_lib/billingClient.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7))
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { patientId, amount, description, dueDate, surgeryId, consultationId } = req.body
  if (!amount || !dueDate || !description) return res.status(400).json({ error: 'Missing fields' })

  // Buscar dados do paciente para criar no provider.
  let customerData = null
  if (patientId) {
    const { data: patient } = await supabase
      .from('patients').select('full_name, cpf, email, phone').eq('id', patientId).single()
    if (patient) customerData = { name: patient.full_name, cpf: patient.cpf, email: patient.email, phone: patient.phone }
  }

  let chargeResult
  try {
    chargeResult = await createCharge({ amount, description, dueDate, customerData })
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }

  const { data: charge } = await supabase.from('charges').insert({
    user_id:            user.id,
    patient_id:         patientId ?? null,
    surgery_id:         surgeryId ?? null,
    consultation_id:    consultationId ?? null,
    amount,
    description,
    due_date:           dueDate,
    status:             chargeResult.status,
    provider_charge_id: chargeResult.providerChargeId,
    payment_link:       chargeResult.paymentLink,
    boleto_barcode:     chargeResult.boletoBarcode,
    boleto_pdf_url:     chargeResult.boletoPdfUrl,
  }).select().single()

  return res.status(200).json({ ok: true, charge })
}
```

---

## Task 4: Endpoint de webhook

**Files:**
- Create: `api/billing/webhook.js`

- [ ] **Step 4.1: Criar endpoint**

```js
// api/billing/webhook.js
// URL para configurar no provider: https://surgimetrics.com.br/api/billing/webhook
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Validação do token do webhook.
  const token = req.headers['asaas-access-token'] || req.query.token
  if (process.env.BILLING_WEBHOOK_TOKEN && token !== process.env.BILLING_WEBHOOK_TOKEN) {
    return res.status(401).end()
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Normalizar payload do provider (Asaas).
  const event = req.body?.event
  const payment = req.body?.payment

  if (!payment?.id) return res.status(200).json({ ok: true })

  const newStatus = event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED'
    ? 'paid'
    : event === 'PAYMENT_OVERDUE' ? 'overdue'
    : event === 'PAYMENT_DELETED' || event === 'PAYMENT_CANCELLED' ? 'cancelled'
    : null

  if (!newStatus) return res.status(200).json({ ok: true })

  // Atualizar cobrança.
  const { data: charge } = await supabase
    .from('charges')
    .update({
      status:     newStatus,
      paid_at:    newStatus === 'paid' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('provider_charge_id', payment.id)
    .select('surgery_id, consultation_id')
    .single()

  // Se pago, atualizar payment_status no lançamento de origem.
  if (newStatus === 'paid' && charge) {
    if (charge.surgery_id) {
      await supabase.from('surgeries').update({ payment_status: 'paid' }).eq('id', charge.surgery_id)
    }
    if (charge.consultation_id) {
      await supabase.from('consultations').update({ payment_status: 'paid' }).eq('id', charge.consultation_id)
    }
  }

  return res.status(200).json({ ok: true })
}
```

---

## Task 5: Componente `ChargeButton.jsx`

**Files:**
- Create: `src/components/ChargeButton.jsx`

- [ ] **Step 5.1: Criar componente**

```jsx
import { useState } from 'react'
import { C, base } from '../theme.js'
import { Modal, Btn, FInput } from './UI.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { today } from '../utils.js'

// Uso: <ChargeButton patientId={id} amount={5000} description="Cirurgia" surgeryId={id} />
export function ChargeButton({ patientId, amount, description, surgeryId, consultationId }) {
  const { session } = useAuth()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    amount:      amount ? String(amount) : '',
    description: description || '',
    dueDate:     (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10) })(),
  })
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function emit() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/billing/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        patientId,
        surgeryId:      surgeryId ?? null,
        consultationId: consultationId ?? null,
        amount:         parseFloat(form.amount),
        description:    form.description,
        dueDate:        form.dueDate,
      }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error || 'Erro ao emitir cobrança'); return }
    setResult(data.charge)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{ padding: '7px 14px', borderRadius: 8, background: C.accent, color: '#fff', border: 'none', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
      >
        💳 Emitir cobrança
      </button>

      <Modal open={open} onClose={() => { setOpen(false); setResult(null); setError(null) }} title="Emitir cobrança" width={460}>
        {!result ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FInput label="Valor (R$)" type="number" value={form.amount} onChange={v => set('amount', v)} />
            <FInput label="Descrição" value={form.description} onChange={v => set('description', v)} />
            <FInput label="Vencimento" type="date" value={form.dueDate} onChange={v => set('dueDate', v)} />
            {error && <p style={{ fontSize: 12, color: C.red }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Btn variant="ghost" onClick={() => setOpen(false)}>Cancelar</Btn>
              <Btn onClick={emit} disabled={loading || !form.amount || !form.description}>{loading ? 'Emitindo…' : 'Emitir boleto'}</Btn>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ color: C.green, fontWeight: 600 }}>✓ Cobrança emitida com sucesso!</p>
            {result.payment_link && (
              <a href={result.payment_link} target="_blank" rel="noopener noreferrer"
                style={{ color: C.accent, fontSize: 13, wordBreak: 'break-all' }}>
                {result.payment_link}
              </a>
            )}
            {result.boleto_barcode && (
              <div>
                <p style={{ fontSize: 11, color: C.textSub, marginBottom: 4 }}>Código de barras:</p>
                <code style={{ fontSize: 11, color: C.text, background: C.surface, padding: '6px 8px', borderRadius: 6, display: 'block', wordBreak: 'break-all' }}>
                  {result.boleto_barcode}
                </code>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              {result.payment_link && (
                <Btn onClick={() => navigator.clipboard.writeText(result.payment_link)} style={{ fontSize: 12 }}>Copiar link</Btn>
              )}
              <Btn variant="ghost" onClick={() => { setOpen(false); setResult(null) }}>Fechar</Btn>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
```

- [ ] **Step 5.2: Usar `ChargeButton` na aba Financeiro do drawer de Patients**

Em `Patients.jsx`, na aba `financeiro` do drawer, adicionar:

```jsx
import { ChargeButton } from './ChargeButton.jsx'

// Dentro da aba financeiro do drawer:
<ChargeButton
  patientId={selectedPatient.id}
  description={`Cobrança — ${selectedPatient.full_name}`}
/>
```

- [ ] **Step 5.3: Configurar env vars na Vercel**

```
BILLING_PROVIDER_URL=https://www.asaas.com/api/v3
BILLING_API_KEY=<access_token_do_asaas>
BILLING_WEBHOOK_TOKEN=<segredo_aleatorio>
```

- [ ] **Step 5.4: Registrar webhook no provider**

No painel do provider (ex: Asaas → Configurações → Webhooks), adicionar:
- URL: `https://surgimetrics.com.br/api/billing/webhook`
- Eventos: `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`, `PAYMENT_CANCELLED`

- [ ] **Step 5.5: Verificar limite de funções Vercel**

```bash
ls api/ | grep -v "_lib\|_middleware" | wc -l
```

Se > 11, agrupar em `api/billing.js` com roteamento por `action`:

```js
// api/billing.js
export default function handler(req, res) {
  const { action } = req.query
  if (action === 'charge')  return handleCharge(req, res)
  if (action === 'webhook') return handleWebhook(req, res)
  return res.status(404).end()
}
```

- [ ] **Step 5.6: Testar fluxo**

```bash
npm run dev
```

1. Abrir paciente → aba Financeiro → clicar "Emitir cobrança"
2. Preencher valor, descrição e vencimento → clicar "Emitir boleto"
3. Confirmar que o link/código aparecem no modal
4. Simular webhook de pagamento (via ferramenta do provider ou curl):

```bash
curl -X POST http://localhost:3000/api/billing/webhook?token=meu-segredo \
  -H "Content-Type: application/json" \
  -d '{"event":"PAYMENT_RECEIVED","payment":{"id":"ID_DO_PROVIDER"}}'
```

5. Verificar no Supabase que `charges.status = 'paid'`

- [ ] **Step 5.7: Commit**

```bash
git add supabase/billing_charges_schema.sql \
        api/_lib/billingClient.js \
        api/billing/charge.js \
        api/billing/webhook.js \
        src/components/ChargeButton.jsx \
        src/components/Patients.jsx \
        vercel.json
git commit -m "feat: emissão de boletos com confirmação automática de pagamento via webhook"
```

- [ ] **Step 5.8: Atualizar CHANGELOG.md**

```
### Added
- Emissão de boletos: cobrança via provider abstrato (Asaas/Iugu), confirmação automática de pagamento por webhook, link do boleto exibido ao emitir. Arquivos: `src/components/ChargeButton.jsx`, `api/billing/`, `supabase/billing_charges_schema.sql`.
```

---

## Self-review

### Cobertura
- ✅ Emissão de boleto/PIX via provider
- ✅ Link e código de barras exibidos após emissão
- ✅ Confirmação automática via webhook
- ✅ Atualiza `payment_status` no lançamento de origem

### Riscos
- **Decisão de caminho (A vs B) não tomada** → implementação pode precisar ser refeita do zero se mudar de gateway para banco direto
- Asaas exige que o CPF do cliente seja válido — pacientes sem CPF cadastrado podem causar erro no provider; o `customerData` é opcional, mas o provider pode rejeitar sem ele
- `BILLING_WEBHOOK_TOKEN` usa `asaas-access-token` header no Asaas — verificar o header correto para o provider escolhido
- Chave de API em `BILLING_API_KEY` dá acesso total à conta do provider — rotacionar periodicamente
- **Caminho B:** certificado A1 é um arquivo `.pfx`/`.p12` com senha — nunca commitar no repositório; armazenar como variável de ambiente codificada em base64 na Vercel

### Fora do escopo
- Cobrança automática via WhatsApp (spec separada — `automacoes-whatsapp.md`)
- Parcelamento
- Notas fiscais
- Emissão de certificado digital (responsabilidade da clínica — ver seção "Decisão arquitetural" acima)
