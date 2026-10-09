# WhatsApp no CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar WhatsApp ao CRM da clínica: uma caixa de entrada unificada por paciente e a capacidade de enviar mensagens de texto a partir do sistema.

**Architecture:** O sistema usa uma **interface abstrata** (`whatsappService`) para isolar o provider (Z-API, Evolution API ou Twilio). Toda lógica de chamada HTTP fica num Vercel serverless (`api/whatsapp/message.js`). O frontend nunca chama o provider diretamente. Mensagens são armazenadas em `whatsapp_messages` no Supabase com webhooks do provider escrevendo mensagens recebidas via `api/whatsapp/webhook.js`. A UI exibe um chat por paciente dentro do drawer.

**Provider escolhido:** Abstrato — plugar o provedor concreto definindo `WHATSAPP_API_URL`, `WHATSAPP_API_KEY` e `WHATSAPP_PHONE_ID` nas env vars da Vercel. A interface é idêntica para Z-API e Evolution API (ambos seguem a API do WhatsApp Business). Para Twilio, ajustar apenas `api/_lib/whatsappClient.js`.

**Tech Stack:** React 18, Supabase (Postgres + Realtime), Vercel serverless, WhatsApp Business API

---

## Referências obrigatórias

- `api/financial-assistant.js` — padrão de serverless Vercel com auth
- `api/_lib/` — helpers existentes de auth e Supabase server-side
- `src/components/Patients.jsx` — onde a aba "WhatsApp" será adicionada
- `src/theme.js` — `C.text`, `C.surface`, `C.border`, `C.accent`, `C.textSub`, `C.green`

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/whatsapp_schema.sql` | Criar | Tabela `whatsapp_messages` |
| `api/_lib/whatsappClient.js` | Criar | Cliente HTTP abstrato para o provider |
| `api/whatsapp/message.js` | Criar | Endpoint: enviar mensagem |
| `api/whatsapp/webhook.js` | Criar | Endpoint: receber mensagem do provider |
| `src/components/WhatsAppChat.jsx` | Criar | UI de chat por paciente |
| `src/components/Patients.jsx` | Modificar | Nova aba "WhatsApp" no drawer |
| `vercel.json` | Modificar | Registrar rotas da API |

---

## Task 1: Schema SQL

**Files:**
- Create: `supabase/whatsapp_schema.sql`

- [ ] **Step 1.1: Criar migração**

```sql
-- whatsapp_schema.sql

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  phone text not null,                   -- número E.164 ex: +5511999999999
  direction text not null check (direction in ('outbound', 'inbound')),
  body text not null,
  status text not null default 'sent'    -- 'sent' | 'delivered' | 'read' | 'failed'
    check (status in ('sent', 'delivered', 'read', 'failed')),
  provider_message_id text,              -- ID retornado pelo provider (para correlação)
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.whatsapp_messages enable row level security;

do $$ begin
  begin
    create policy "WhatsApp messages own rows" on public.whatsapp_messages
      for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;

create index if not exists idx_whatsapp_patient on public.whatsapp_messages(patient_id, created_at desc);
create index if not exists idx_whatsapp_phone on public.whatsapp_messages(user_id, phone, created_at desc);
```

- [ ] **Step 1.2: Aplicar no Supabase**

Executar no SQL Editor.

---

## Task 2: Cliente HTTP abstrato

**Files:**
- Create: `api/_lib/whatsappClient.js`

- [ ] **Step 2.1: Criar o cliente**

```js
// api/_lib/whatsappClient.js
// Interface abstrata para providers WhatsApp Business-compatible.
// Configurar via env vars:
//   WHATSAPP_API_URL   — ex: https://api.z-api.io/instances/{id}/token/{token}
//   WHATSAPP_API_KEY   — bearer token ou client-token dependendo do provider
//   WHATSAPP_PHONE_ID  — phone number id (para Meta/Twilio) ou deixar vazio

export async function sendWhatsAppText(to, text) {
  const apiUrl = process.env.WHATSAPP_API_URL
  const apiKey = process.env.WHATSAPP_API_KEY

  if (!apiUrl || !apiKey) {
    throw new Error('WhatsApp não configurado. Defina WHATSAPP_API_URL e WHATSAPP_API_KEY.')
  }

  // Formato compatível com Z-API e Evolution API.
  const body = JSON.stringify({ phone: to, message: text })

  const res = await fetch(`${apiUrl}/send-text`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.status)
    throw new Error(`WhatsApp provider error: ${errText}`)
  }

  const data = await res.json()
  return data?.messageId ?? data?.id ?? null
}
```

---

## Task 3: Endpoint de envio

**Files:**
- Create: `api/whatsapp/message.js`

- [ ] **Step 3.1: Criar endpoint**

```js
// api/whatsapp/message.js
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppText } from '../_lib/whatsappClient.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing auth' })

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7))
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { patientId, phone, text } = req.body
  if (!phone || !text) return res.status(400).json({ error: 'phone and text are required' })

  let providerId = null
  try {
    providerId = await sendWhatsAppText(phone, text)
  } catch (err) {
    await supabase.from('whatsapp_messages').insert({
      user_id: user.id,
      patient_id: patientId ?? null,
      phone,
      direction: 'outbound',
      body: text,
      status: 'failed',
    })
    return res.status(502).json({ error: err.message })
  }

  const { data: msg } = await supabase.from('whatsapp_messages').insert({
    user_id: user.id,
    patient_id: patientId ?? null,
    phone,
    direction: 'outbound',
    body: text,
    status: 'sent',
    provider_message_id: providerId,
  }).select().single()

  return res.status(200).json({ ok: true, messageId: msg?.id })
}
```

---

## Task 4: Endpoint de webhook (mensagens recebidas)

**Files:**
- Create: `api/whatsapp/webhook.js`

- [ ] **Step 4.1: Criar endpoint**

```js
// api/whatsapp/webhook.js
// Recebe notificações do provider (mensagens chegando na linha da clínica).
// Configurar no dashboard do provider como webhook URL:
//   https://surgimetrics.com.br/api/whatsapp/webhook

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Verificação de webhook (Meta/Evolution API).
    const challenge = req.query['hub.challenge']
    if (challenge) return res.status(200).send(challenge)
    return res.status(200).json({ ok: true })
  }

  if (req.method !== 'POST') return res.status(405).end()

  // Validação básica de token do webhook.
  const webhookToken = req.headers['x-webhook-token'] || req.query.token
  if (process.env.WHATSAPP_WEBHOOK_TOKEN && webhookToken !== process.env.WHATSAPP_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'Invalid webhook token' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // Normalizar payload — Z-API e Evolution API têm estruturas diferentes.
  // Este parser cobre Z-API; ajustar para outros providers.
  const body = req.body
  const phone = body?.phone || body?.from || body?.sender?.phone
  const text = body?.text?.message || body?.message?.conversation || body?.body || ''

  if (!phone || !text) return res.status(200).json({ ok: true }) // ignora mensagens sem conteúdo

  // Identificar a qual usuário (clínica) pertence este número.
  // Como o webhook não carrega user_id, associar pelo número da linha configurado.
  // Estratégia simples: usar o WHATSAPP_OWNER_USER_ID (a conta da Dra.) definido na env.
  const ownerUserId = process.env.WHATSAPP_OWNER_USER_ID
  if (!ownerUserId) return res.status(200).json({ ok: true })

  // Encontrar paciente pelo telefone.
  const normalizedPhone = phone.replace(/\D/g, '')
  const { data: patient } = await supabase
    .from('patients')
    .select('id')
    .eq('user_id', ownerUserId)
    .ilike('phone', `%${normalizedPhone.slice(-9)}%`)
    .maybeSingle()

  await supabase.from('whatsapp_messages').insert({
    user_id: ownerUserId,
    patient_id: patient?.id ?? null,
    phone: phone,
    direction: 'inbound',
    body: text,
    status: 'read',
    provider_message_id: body?.messageId ?? body?.id ?? null,
  })

  return res.status(200).json({ ok: true })
}
```

---

## Task 5: Componente `WhatsAppChat.jsx`

**Files:**
- Create: `src/components/WhatsAppChat.jsx`

- [ ] **Step 5.1: Criar componente com Supabase Realtime**

```jsx
import { useEffect, useRef, useState } from 'react'
import { C, base } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

export function WhatsAppChat({ patientId, phone }) {
  const { session } = useAuth()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!patientId || !phone) return
    loadMessages()

    // Subscrever a mensagens recebidas em tempo real.
    const channel = supabase
      .channel(`whatsapp-${patientId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `patient_id=eq.${patientId}`,
      }, payload => {
        setMessages(prev => [...prev, payload.new])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [patientId, phone])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadMessages() {
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: true })
    setMessages(data ?? [])
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!text.trim() || !phone) return
    setSending(true)

    await fetch('/api/whatsapp/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ patientId, phone, text: text.trim() }),
    })

    setText('')
    setSending(false)
    loadMessages()
  }

  if (!phone) return (
    <div style={{ padding: 24, color: C.textDim, fontSize: 13 }}>
      Este paciente não tem telefone cadastrado. Adicione na aba Dados.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 480 }}>
      {/* Mensagens */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && (
          <p style={{ color: C.textDim, fontSize: 13, textAlign: 'center', padding: '32px 0' }}>Nenhuma mensagem ainda.</p>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Escreva uma mensagem…"
          style={{ ...base.input, flex: 1 }}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          style={{ padding: '0 16px', borderRadius: 10, background: C.accent, color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          {sending ? '…' : 'Enviar'}
        </button>
      </form>
    </div>
  )
}

function MessageBubble({ msg }) {
  const isOut = msg.direction === 'outbound'
  return (
    <div style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start', padding: '0 4px' }}>
      <div style={{
        maxWidth: '72%',
        background: isOut ? C.accent : C.surface,
        color: isOut ? '#fff' : C.text,
        border: isOut ? 'none' : `1px solid ${C.border}`,
        borderRadius: isOut ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
        padding: '8px 12px',
        fontSize: 13,
        lineHeight: 1.5,
      }}>
        <div>{msg.body}</div>
        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: 'right' }}>
          {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {msg.direction === 'outbound' && (
            <span style={{ marginLeft: 4 }}>
              {msg.status === 'read' ? '✓✓' : msg.status === 'delivered' ? '✓✓' : msg.status === 'failed' ? '✗' : '✓'}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
```

---

## Task 6: Aba "WhatsApp" em Patients + configuração de rotas

**Files:**
- Modify: `src/components/Patients.jsx`
- Modify: `vercel.json`

- [ ] **Step 6.1: Adicionar aba "whatsapp" no drawer**

```js
const DRAWER_TABS = ['resumo', 'pessoal', 'anamnese', 'prontuario', 'exames', 'receita', 'documentos', 'whatsapp', 'financeiro']
const DRAWER_TAB_LABELS = { ..., whatsapp: 'WhatsApp' }
```

- [ ] **Step 6.2: Renderizar `WhatsAppChat`**

```jsx
import { WhatsAppChat } from './WhatsAppChat.jsx'

{activeDrawerTab === 'whatsapp' && (
  <WhatsAppChat
    patientId={selectedPatient.id}
    phone={selectedPatient.phone}
  />
)}
```

- [ ] **Step 6.3: Verificar limite de funções na Vercel**

```bash
ls api/ | grep -v "_lib\|_middleware"
```

O plano gratuito da Vercel tem limite de 12 funções serverless. Contar quantas existem. Se ultrapassar 12, usar o padrão de roteamento por parâmetro (como `api/google/calendar.js`):

```js
// api/whatsapp.js — um único arquivo com roteamento interno
export default function handler(req, res) {
  const { action } = req.query
  if (action === 'message') return handleMessage(req, res)
  if (action === 'webhook') return handleWebhook(req, res)
  return res.status(404).end()
}
```

- [ ] **Step 6.4: Adicionar rotas em `vercel.json`**

Verificar o arquivo atual e adicionar:

```json
{ "source": "/api/whatsapp/(.*)", "destination": "/api/whatsapp/$1" }
```

Ou, se usando arquivo único:

```json
{ "source": "/api/whatsapp/message", "destination": "/api/whatsapp?action=message" },
{ "source": "/api/whatsapp/webhook", "destination": "/api/whatsapp?action=webhook" }
```

- [ ] **Step 6.5: Configurar env vars na Vercel**

No dashboard Vercel → Settings → Environment Variables:
- `WHATSAPP_API_URL` — URL base do provider (ex: `https://api.z-api.io/instances/{id}/token/{token}`)
- `WHATSAPP_API_KEY` — token de autenticação
- `WHATSAPP_WEBHOOK_TOKEN` — segredo para validar webhooks (qualquer string aleatória)
- `WHATSAPP_OWNER_USER_ID` — UUID do usuário da Dra. Vitoria no Supabase Auth

- [ ] **Step 6.6: Testar localmente com .env.local**

```bash
# .env.local (não commitar!)
WHATSAPP_API_URL=https://api.z-api.io/instances/SEU_ID/token/SEU_TOKEN
WHATSAPP_API_KEY=SEU_TOKEN
WHATSAPP_WEBHOOK_TOKEN=meu-segredo-123
WHATSAPP_OWNER_USER_ID=uuid-da-dra
```

```bash
npm run dev
```

1. Abrir paciente → aba WhatsApp
2. Enviar uma mensagem → confirmar que aparece na bolha de "enviado"
3. Verificar no dashboard do provider que a mensagem foi entregue

- [ ] **Step 6.7: Commit**

```bash
git add supabase/whatsapp_schema.sql \
        api/_lib/whatsappClient.js \
        api/whatsapp/message.js \
        api/whatsapp/webhook.js \
        src/components/WhatsAppChat.jsx \
        src/components/Patients.jsx \
        vercel.json
git commit -m "feat: WhatsApp integrado ao CRM — chat por paciente com histórico e realtime"
```

- [ ] **Step 6.8: Atualizar CHANGELOG.md**

```
### Added
- WhatsApp no CRM: chat por paciente com histórico de mensagens, recebimento via webhook e envio via API. Interface abstrata para qualquer provider Business-compatible. Arquivos: `src/components/WhatsAppChat.jsx`, `api/whatsapp/`, `supabase/whatsapp_schema.sql`.
```

---

## Self-review

### Cobertura
- ✅ Histórico de mensagens por paciente
- ✅ Envio de texto via serverless
- ✅ Recebimento via webhook
- ✅ Realtime com Supabase channels

### Riscos
- `WHATSAPP_OWNER_USER_ID` é estático — não funciona com multi-clínica até que o controle de acesso resolva a associação de número por clínica
- O parser de webhook é específico para Z-API — documentado claramente no código com "ajustar para outros providers"
- Número de funções Vercel: verificar limite antes de criar arquivos separados

### Fora do escopo
- Envio de mídia (imagens, áudios)
- Templates aprovados pela Meta (para mensagens fora de janela de 24h)
- Automações (spec separada)
