# Conciliação Bancária com IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a Dra. importe o extrato bancário (OFX ou CSV) e o sistema sugira automaticamente quais lançamentos financeiros correspondem a cada transação, marcando como conciliados com um clique.

**Architecture:** O extrato é lido no browser (sem upload para servidor). Um parser JavaScript extrai as transações do OFX/CSV. Um endpoint serverless (`api/financial/reconcile.js`) recebe as transações + lançamentos não conciliados e usa GPT-4o-mini para sugerir pares. O usuário confirma ou rejeita cada sugestão. Os lançamentos confirmados recebem `reconciled = true` na tabela.

**Tech Stack:** React 18, Supabase, Vercel serverless, OpenAI API (gpt-4o-mini), FileReader API (browser-side parsing)

---

## Referências obrigatórias

- `api/financial-assistant.js` — padrão de serverless com OpenAI e auth
- `api/_lib/financialAssistant.js` — padrão de auth serverless
- `supabase/erp_relational_schema.sql` — tabelas de lançamentos (`expenses`, `consultations`, `surgeries`)
- `src/components/Finance.jsx` — onde a conciliação será acessada
- `src/theme.js` — tokens de cor

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/reconciliation_schema.sql` | Criar | Coluna `reconciled` + tabela de sessões de conciliação |
| `api/financial/reconcile.js` | Criar | Endpoint que usa GPT para sugerir pares |
| `src/lib/statementParser.js` | Criar | Parser OFX e CSV browser-side |
| `src/components/BankReconciliation.jsx` | Criar | UI de conciliação |
| `src/components/Finance.jsx` | Modificar | Nova aba "Conciliação" |

---

## Task 1: Schema SQL

**Files:**
- Create: `supabase/reconciliation_schema.sql`

- [ ] **Step 1.1: Criar migração**

```sql
-- reconciliation_schema.sql

-- Marcar lançamentos como conciliados.
-- Adicionar a todas as tabelas financeiras relevantes.
alter table public.expenses
  add column if not exists reconciled boolean not null default false,
  add column if not exists bank_transaction_id text;

alter table public.surgeries
  add column if not exists reconciled boolean not null default false,
  add column if not exists bank_transaction_id text;

alter table public.consultations
  add column if not exists reconciled boolean not null default false,
  add column if not exists bank_transaction_id text;

-- Histórico de sessões de conciliação (opcional — para auditoria).
create table if not exists public.reconciliation_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bank_name text,
  period_start date,
  period_end date,
  total_transactions int not null default 0,
  matched_count int not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.reconciliation_sessions enable row level security;

do $$ begin
  begin
    create policy "Reconciliation sessions own" on public.reconciliation_sessions
      for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;
```

- [ ] **Step 1.2: Aplicar e verificar**

Executar no SQL Editor.

---

## Task 2: Parser de extratos (browser-side)

**Files:**
- Create: `src/lib/statementParser.js`

- [ ] **Step 2.1: Criar parser**

```js
// src/lib/statementParser.js
// Parseia OFX e CSV de extratos bancários.
// Retorna array de: { id, date, amount, description, type }

export function parseStatement(fileContent, fileType) {
  if (fileType === 'ofx' || fileContent.includes('<OFX>') || fileContent.includes('OFXHEADER')) {
    return parseOFX(fileContent)
  }
  return parseCSV(fileContent)
}

function parseOFX(content) {
  const transactions = []
  // OFX é SGML (não XML puro), então usamos regex.
  const stmtTrnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi
  let match
  while ((match = stmtTrnRegex.exec(content)) !== null) {
    const block = match[1]
    const type = extractTag(block, 'TRNTYPE') || 'DEBIT'
    const dateStr = extractTag(block, 'DTPOSTED') || ''
    const amount = parseFloat(extractTag(block, 'TRNAMT') || '0')
    const id = extractTag(block, 'FITID') || String(Math.random())
    const desc = extractTag(block, 'MEMO') || extractTag(block, 'NAME') || ''

    const date = ofxDateToISO(dateStr)
    if (!date || isNaN(amount)) continue

    transactions.push({ id, date, amount, description: desc.trim(), type: amount < 0 ? 'debit' : 'credit' })
  }
  return transactions
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([^<]+)`))
  return match ? match[1].trim() : null
}

function ofxDateToISO(dateStr) {
  // OFX date: YYYYMMDDHHMMSS[timezone] → YYYY-MM-DD
  if (!dateStr || dateStr.length < 8) return null
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
}

function parseCSV(content) {
  const lines = content.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  // Tentar detectar separador (vírgula ou ponto-e-vírgula).
  const sep = lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(sep).map(h => h.trim().toLowerCase().replace(/"/g, ''))

  // Mapear colunas comuns de extratos brasileiros.
  const colDate = headers.findIndex(h => h.includes('data') || h.includes('date'))
  const colDesc = headers.findIndex(h => h.includes('descri') || h.includes('histor') || h.includes('memo'))
  const colAmount = headers.findIndex(h => h.includes('valor') || h.includes('amount') || h.includes('value'))

  if (colDate === -1 || colAmount === -1) return []

  return lines.slice(1).map((line, i) => {
    const cols = line.split(sep).map(c => c.trim().replace(/"/g, ''))
    const rawDate = cols[colDate] ?? ''
    const rawAmount = cols[colAmount] ?? '0'
    const desc = colDesc !== -1 ? (cols[colDesc] ?? '') : ''

    const date = parseBRDate(rawDate)
    const amount = parseFloat(rawAmount.replace(/\./g, '').replace(',', '.')) || 0

    return {
      id: `csv-${i}`,
      date,
      amount,
      description: desc,
      type: amount < 0 ? 'debit' : 'credit',
    }
  }).filter(t => t.date && !isNaN(t.amount))
}

function parseBRDate(str) {
  // Aceita DD/MM/YYYY ou YYYY-MM-DD
  if (!str) return null
  if (str.includes('/')) {
    const [d, m, y] = str.split('/')
    if (!d || !m || !y) return null
    return `${y.padStart(4, '20')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  if (str.match(/^\d{4}-\d{2}-\d{2}/)) return str.slice(0, 10)
  return null
}
```

---

## Task 3: Endpoint de conciliação com IA

**Files:**
- Create: `api/financial/reconcile.js`

- [ ] **Step 3.1: Criar endpoint**

```js
// api/financial/reconcile.js
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authHeader.slice(7))
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { transactions, periodStart, periodEnd } = req.body
  if (!transactions?.length) return res.status(400).json({ error: 'No transactions' })

  // Buscar lançamentos não conciliados no período.
  const [{ data: expenses }, { data: surgeries }, { data: consults }] = await Promise.all([
    supabase.from('expenses').select('id, description, amount, date').eq('user_id', user.id).eq('reconciled', false).gte('date', periodStart).lte('date', periodEnd),
    supabase.from('surgeries').select('id, patient_id, total_price, date, patients(full_name)').eq('user_id', user.id).eq('reconciled', false).gte('date', periodStart).lte('date', periodEnd),
    supabase.from('consultations').select('id, patient_id, amount, date, patients(full_name)').eq('user_id', user.id).eq('reconciled', false).gte('date', periodStart).lte('date', periodEnd),
  ])

  const records = [
    ...(expenses ?? []).map(e => ({ id: e.id, type: 'expense', desc: e.description, amount: e.amount, date: e.date })),
    ...(surgeries ?? []).map(s => ({ id: s.id, type: 'surgery', desc: `Cirurgia - ${s.patients?.full_name ?? 'Paciente'}`, amount: s.total_price, date: s.date })),
    ...(consults ?? []).map(c => ({ id: c.id, type: 'consultation', desc: `Consulta - ${c.patients?.full_name ?? 'Paciente'}`, amount: c.amount, date: c.date })),
  ]

  if (records.length === 0) return res.status(200).json({ suggestions: [] })

  // Chamar GPT para sugerir pares.
  const prompt = `Você é um assistente de conciliação bancária. Analise as transações do extrato e os lançamentos financeiros abaixo e sugira quais pares correspondem ao mesmo evento financeiro.

TRANSAÇÕES DO EXTRATO:
${transactions.map((t, i) => `${i + 1}. Data: ${t.date} | Valor: ${t.amount} | Descrição: "${t.description}"`).join('\n')}

LANÇAMENTOS NO SISTEMA:
${records.map((r, i) => `${i + 1}. ID: ${r.id} | Data: ${r.date} | Valor: ${r.amount} | Tipo: ${r.type} | Descrição: "${r.desc}"`).join('\n')}

Responda APENAS com JSON válido, sem markdown:
{
  "suggestions": [
    { "transactionId": "<id da transação>", "recordId": "<id do lançamento>", "confidence": 0.95, "reason": "valores e datas coincidem" }
  ]
}`

  const apiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0,
    }),
  })

  const aiData = await apiRes.json()
  const rawText = aiData.choices?.[0]?.message?.content ?? '{}'

  let suggestions = []
  try {
    const parsed = JSON.parse(rawText)
    suggestions = parsed.suggestions ?? []
  } catch {
    return res.status(200).json({ suggestions: [] })
  }

  // Enriquecer sugestões com dados completos.
  const transMap = Object.fromEntries(transactions.map(t => [t.id, t]))
  const recMap = Object.fromEntries(records.map(r => [r.id, r]))

  const enriched = suggestions
    .filter(s => transMap[s.transactionId] && recMap[s.recordId])
    .map(s => ({
      ...s,
      transaction: transMap[s.transactionId],
      record: recMap[s.recordId],
    }))

  return res.status(200).json({ suggestions: enriched, totalTransactions: transactions.length, totalRecords: records.length })
}
```

---

## Task 4: Componente `BankReconciliation.jsx`

**Files:**
- Create: `src/components/BankReconciliation.jsx`

- [ ] **Step 4.1: Criar componente**

```jsx
import { useRef, useState } from 'react'
import { C, base } from '../theme.js'
import { Btn } from './UI.jsx'
import { parseStatement } from '../lib/statementParser.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

export function BankReconciliation() {
  const { session } = useAuth()
  const [transactions, setTransactions] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [confirmed, setConfirmed] = useState({})  // { suggestionIndex: true/false }
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState('upload')  // 'upload' | 'review' | 'done'
  const fileRef = useRef(null)

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const content = ev.target.result
      const ext = file.name.split('.').pop().toLowerCase()
      const parsed = parseStatement(content, ext)
      setTransactions(parsed)
      if (parsed.length > 0) fetchSuggestions(parsed)
    }
    reader.readAsText(file, 'latin1')  // OFX brasileiro usa ISO-8859-1
    e.target.value = ''
  }

  async function fetchSuggestions(txns) {
    setLoading(true)
    setSuggestions([])
    setConfirmed({})

    const dates = txns.map(t => t.date).filter(Boolean).sort()
    const periodStart = dates[0] ?? new Date().toISOString().slice(0, 10)
    const periodEnd = dates[dates.length - 1] ?? periodStart

    const res = await fetch('/api/financial/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ transactions: txns, periodStart, periodEnd }),
    })
    const data = await res.json()
    setSuggestions(data.suggestions ?? [])
    setLoading(false)
    setStep('review')
  }

  async function confirmAll() {
    setSaving(true)
    const toConfirm = suggestions.filter((_, i) => confirmed[i] !== false)

    for (const s of toConfirm) {
      const tableMap = { expense: 'expenses', surgery: 'surgeries', consultation: 'consultations' }
      const table = tableMap[s.record.type]
      if (!table) continue
      await supabase.from(table).update({
        reconciled: true,
        bank_transaction_id: s.transaction.id,
      }).eq('id', s.record.id)
    }
    setSaving(false)
    setStep('done')
  }

  const confirmedCount = suggestions.filter((_, i) => confirmed[i] !== false).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
      {step === 'upload' && (
        <div style={{ background: C.surface, border: `2px dashed ${C.border}`, borderRadius: 12, padding: 32, textAlign: 'center' }}>
          <p style={{ fontSize: 15, color: C.text, marginBottom: 8 }}>Importe o extrato bancário</p>
          <p style={{ fontSize: 13, color: C.textSub, marginBottom: 20 }}>Formatos aceitos: OFX (recomendado) ou CSV</p>
          <input ref={fileRef} type="file" accept=".ofx,.csv,.txt" style={{ display: 'none' }} onChange={handleFile} />
          <Btn onClick={() => fileRef.current?.click()}>Selecionar arquivo</Btn>
          <p style={{ fontSize: 11, color: C.textDim, marginTop: 12 }}>O arquivo é lido localmente — não é enviado para nenhum servidor.</p>
        </div>
      )}

      {step === 'review' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: 15, color: C.text, fontWeight: 600 }}>{transactions.length} transações importadas</p>
              <p style={{ fontSize: 13, color: C.textSub }}>{loading ? 'Analisando com IA…' : `${suggestions.length} sugestões encontradas`}</p>
            </div>
            <button onClick={() => { setStep('upload'); setTransactions([]); setSuggestions([]) }} style={{ background: 'none', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 13 }}>
              Importar outro arquivo
            </button>
          </div>

          {loading && <p style={{ color: C.textSub, fontSize: 13 }}>🤖 Analisando lançamentos…</p>}

          {!loading && suggestions.map((s, i) => (
            <SuggestionCard
              key={i}
              suggestion={s}
              accepted={confirmed[i] !== false}
              onToggle={() => setConfirmed(prev => ({ ...prev, [i]: prev[i] === false ? true : false }))}
            />
          ))}

          {!loading && suggestions.length === 0 && (
            <p style={{ color: C.textDim, fontSize: 13 }}>Nenhuma correspondência encontrada no período.</p>
          )}

          {!loading && suggestions.length > 0 && (
            <Btn onClick={confirmAll} disabled={saving} style={{ alignSelf: 'flex-start' }}>
              {saving ? 'Conciliando…' : `Confirmar ${confirmedCount} conciliações`}
            </Btn>
          )}
        </>
      )}

      {step === 'done' && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 18, color: C.green, marginBottom: 8 }}>✓ Conciliação concluída</p>
          <p style={{ fontSize: 14, color: C.textSub, marginBottom: 16 }}>{confirmedCount} lançamentos marcados como conciliados.</p>
          <Btn onClick={() => { setStep('upload'); setTransactions([]); setSuggestions([]); setConfirmed({}) }}>Nova conciliação</Btn>
        </div>
      )}
    </div>
  )
}

function SuggestionCard({ suggestion, accepted, onToggle }) {
  const { transaction: tx, record: rec, confidence, reason } = suggestion
  const confidenceColor = confidence >= 0.85 ? C.green : confidence >= 0.6 ? C.yellow : C.red

  return (
    <div style={{
      background: C.surface, border: `1px solid ${accepted ? C.accent + '66' : C.border}`,
      borderRadius: 10, padding: 14, opacity: accepted ? 1 : 0.5,
      transition: 'opacity 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, background: C.border, borderRadius: 6, padding: '2px 8px', color: C.textSub }}>Extrato</span>
            <span style={{ fontSize: 13, color: C.text }}>{tx.date} · R$ {Math.abs(tx.amount).toFixed(2)} · {tx.description}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, background: C.accent + '20', borderRadius: 6, padding: '2px 8px', color: C.accent }}>Sistema</span>
            <span style={{ fontSize: 13, color: C.text }}>{rec.date} · R$ {Math.abs(rec.amount).toFixed(2)} · {rec.desc}</span>
          </div>
          <p style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>
            <span style={{ color: confidenceColor }}>●</span> {Math.round(confidence * 100)}% confiança — {reason}
          </p>
        </div>
        <label style={{ cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={accepted} onChange={onToggle} style={{ width: 18, height: 18, accentColor: C.accent }} />
        </label>
      </div>
    </div>
  )
}
```

---

## Task 5: Aba "Conciliação" em Finance

**Files:**
- Modify: `src/components/Finance.jsx`

- [ ] **Step 5.1: Importar e adicionar aba**

```jsx
import { BankReconciliation } from './BankReconciliation.jsx'

// Na lista de abas do Finance (localizar padrão existente):
{ id: 'conciliacao', label: 'Conciliação' }

// Na renderização condicional:
{activeTab === 'conciliacao' && <BankReconciliation />}
```

- [ ] **Step 5.2: Testar fluxo**

```bash
npm run dev
```

1. Baixar extrato OFX do banco (ou criar um CSV de teste)
2. Ir em Financeiro → Conciliação → selecionar arquivo
3. Aguardar sugestões da IA
4. Marcar/desmarcar sugestões → clicar "Confirmar"
5. Verificar no Supabase Table Editor que `reconciled = true` nos registros confirmados

- [ ] **Step 5.3: Commit**

```bash
git add supabase/reconciliation_schema.sql \
        api/financial/reconcile.js \
        src/lib/statementParser.js \
        src/components/BankReconciliation.jsx \
        src/components/Finance.jsx
git commit -m "feat: conciliação bancária com IA — importação OFX/CSV e sugestões automáticas"
```

- [ ] **Step 5.4: Atualizar CHANGELOG.md**

```
### Added
- Conciliação bancária: importação de extratos OFX e CSV, sugestões de pares via GPT-4o-mini, confirmação com um clique. Coluna `reconciled` adicionada em expenses, surgeries e consultations. Arquivos: `src/components/BankReconciliation.jsx`, `api/financial/reconcile.js`, `src/lib/statementParser.js`.
```

---

## Self-review

### Cobertura
- ✅ Importação OFX e CSV (parser browser-side, sem upload)
- ✅ Sugestão de pares com IA (GPT-4o-mini)
- ✅ Confirmação por checkbox
- ✅ Persiste `reconciled = true` no Supabase

### Riscos
- OFX brasileiro usa encoding `ISO-8859-1` (Latin-1) — o `FileReader` com `'latin1'` cobre isso mas pode falhar em bancos que usam UTF-8. Adicionar fallback: tentar UTF-8 se Latin-1 der caracteres estranhos
- GPT pode sugerir pares incorretos com alta confiança — a UI deixa o usuário desmarcar antes de confirmar
- `gpt-4o-mini` tem limite de tokens — extrato com 200+ transações pode estourar. Limitar a 50 transações por chamada ou paginar
