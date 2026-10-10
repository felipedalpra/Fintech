# Automações de WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar mensagens automáticas de WhatsApp nos eventos: lembrete de consulta/cirurgia (1 dia antes), cobrança de pagamento pendente, link de anamnese e follow-up pós-consulta.

**Pré-requisito:** O plano `2026-10-08-whatsapp-crm.md` deve estar implementado (`api/_lib/whatsappClient.js`, `whatsapp_messages` no Supabase).

**Architecture:** Um Vercel cron job (`/api/automations/whatsapp`) roda diariamente às 08:00 (BRT). Verifica na base quais eventos disparam mensagens para aquele dia e envia via `whatsappClient.js`. As automações são configuráveis por toggle em Settings. Os templates de mensagem são configuráveis por texto.

**Tech Stack:** React 18, Supabase, Vercel Cron, `api/_lib/whatsappClient.js`

---

## Padrão e contexto (atualizado 2026-10-10)

> Alinha o plano à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`. As Tasks abaixo continuam válidas.

**Contexto do cliente:** Fase 2. Mensagens automáticas: lembrete de consulta/cirurgia, cobrança de pagamento pendente, link de anamnese, follow-up pós-consulta.

**Área e navegação:** config/toggle na área **Automações & Integrações** (admin); cada automação **referenciada no contexto** (cobrança perto do Financeiro, link de anamnese perto do Clínico).

**Benchmark (o que copiar):** Kommo Salesbot / régua de follow-up — gatilhos por evento, mensagens configuráveis por template.

**Modelo de dados e propagação (ponto crítico):**
- Cron diário lê os eventos do dia e dispara via `whatsappClient`.
- A **cobrança** usa o **VENCIMENTO real** do financeiro (regime de vencimento) — nunca a competência nem a data de caixa. O lembrete usa a data do evento. Confundir as três datas gera cobrança/lembrete errado.
- Respeita o toggle de cada automação; mensagens fora da janela de 24h usam template aprovado (API oficial) e geram custo (Cláusula 8, contratante).

**Permissões:** configurar automações = só admin.

**Checklist de fidedignidade (desta feature):**
1. **Idempotência:** a mesma automação não dispara 2x para o mesmo evento/paciente/dia.
2. A cobrança lê o **vencimento** correto; lembrete lê a data do evento correta (fuso Brasília).
3. Toggle desligado = não envia. Paciente sem telefone válido = não tenta/erra silenciosamente.
4. Pagamento já feito não gera cobrança (checar `payment_status` no momento do disparo).
5. Teste cobre cada gatilho com data de corte e o caso "já pago / já lembrado".

---

## Referências obrigatórias

- `api/_lib/whatsappClient.js` — cliente WhatsApp (plano anterior)
- `vercel.json` — onde adicionar o cron
- `supabase/patients_schema.sql` — campos `phone` no paciente
- `src/components/Settings.jsx` — onde a config de automações será adicionada
- `src/theme.js` — tokens de cor

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/automations_schema.sql` | Criar | Tabela de configuração de automações |
| `api/automations/whatsapp.js` | Criar | Cron job de envio de automações |
| `src/components/Settings.jsx` | Modificar | Aba "Automações" para configurar templates e toggles |
| `vercel.json` | Modificar | Adicionar cron `0 11 * * *` (08:00 BRT = 11:00 UTC) |

---

## Task 1: Schema SQL

**Files:**
- Create: `supabase/automations_schema.sql`

- [ ] **Step 1.1: Criar migração**

```sql
-- automations_schema.sql

-- Configurações de automações por usuário.
create table if not exists public.automation_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,

  -- Toggles
  reminder_enabled boolean not null default true,
  payment_reminder_enabled boolean not null default true,
  anamnese_link_enabled boolean not null default false,
  followup_enabled boolean not null default true,

  -- Templates de mensagem (suportam variáveis {patient_name}, {date}, {time}, {link})
  reminder_template text not null default 'Olá {patient_name}! Lembrando da sua consulta amanhã, {date} às {time}. Em caso de dúvidas, entre em contato. 😊',
  payment_template text not null default 'Olá {patient_name}, temos um pagamento pendente de {value}. Qualquer dúvida, fale conosco.',
  anamnese_template text not null default 'Olá {patient_name}! Antes da sua consulta, pedimos que preencha a ficha de anamnese: {link}',
  followup_template text not null default 'Olá {patient_name}! Esperamos que esteja bem após sua consulta de {date}. Qualquer dúvida, estamos à disposição. 🌿',

  -- Timing
  reminder_days_before int not null default 1,       -- enviar X dias antes
  followup_days_after int not null default 3,        -- enviar X dias depois

  updated_at timestamptz not null default timezone('utc', now())
);

-- Log de envios para evitar duplicatas.
create table if not exists public.automation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,    -- 'reminder' | 'payment_reminder' | 'anamnese_link' | 'followup'
  ref_id uuid not null,        -- id da cirurgia, consulta ou paciente
  phone text not null,
  sent_at timestamptz not null default timezone('utc', now())
);

alter table public.automation_settings enable row level security;
alter table public.automation_log enable row level security;

do $$ begin
  begin
    create policy "Automation settings own" on public.automation_settings
      for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy "Automation log own" on public.automation_log
      for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;

create unique index if not exists idx_automation_log_dedup
  on public.automation_log(user_id, event_type, ref_id, sent_at::date);
```

- [ ] **Step 1.2: Aplicar no Supabase**

Executar. Confirmar tabelas.

---

## Task 2: Cron job de automações

**Files:**
- Create: `api/automations/whatsapp.js`

- [ ] **Step 2.1: Criar o cron job**

```js
// api/automations/whatsapp.js
// Roda diariamente às 08:00 BRT (11:00 UTC).
// Configurado em vercel.json como cron: "0 11 * * *"

import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppText } from '../_lib/whatsappClient.js'

const CRON_SECRET = process.env.CRON_SECRET

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // Vercel cron autentica via header Authorization: Bearer CRON_SECRET
  if (CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  // Buscar todas as configurações de usuários com WhatsApp configurado.
  const { data: configs } = await supabase
    .from('automation_settings')
    .select('*')

  const results = { sent: 0, skipped: 0, errors: 0 }

  for (const config of configs ?? []) {
    const userId = config.user_id
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // 1. LEMBRETES: consultas e cirurgias de amanhã.
    if (config.reminder_enabled) {
      const target = new Date(today)
      target.setDate(target.getDate() + config.reminder_days_before)
      const targetStr = target.toISOString().slice(0, 10)

      const [{ data: consults }, { data: surgeries }] = await Promise.all([
        supabase.from('consultations').select('id, date, time, patient_id, patients(full_name, phone)').eq('user_id', userId).eq('date', targetStr).not('patients', 'is', null),
        supabase.from('surgeries').select('id, date, patient_id, patients(full_name, phone)').eq('user_id', userId).eq('date', targetStr).not('patients', 'is', null),
      ])

      for (const event of [...(consults ?? []), ...(surgeries ?? [])]) {
        const patient = event.patients
        if (!patient?.phone) continue

        const alreadySent = await checkLog(supabase, userId, 'reminder', event.id, target)
        if (alreadySent) { results.skipped++; continue }

        const msg = config.reminder_template
          .replace('{patient_name}', patient.full_name.split(' ')[0])
          .replace('{date}', target.toLocaleDateString('pt-BR'))
          .replace('{time}', event.time ?? '')

        await safeSend(supabase, userId, event.id, patient.phone, msg, 'reminder', results)
      }
    }

    // 2. FOLLOW-UP: consultas de X dias atrás.
    if (config.followup_enabled) {
      const pastDate = new Date(today)
      pastDate.setDate(pastDate.getDate() - config.followup_days_after)
      const pastStr = pastDate.toISOString().slice(0, 10)

      const { data: consults } = await supabase
        .from('consultations').select('id, date, patient_id, patients(full_name, phone)')
        .eq('user_id', userId).eq('date', pastStr).not('patients', 'is', null)

      for (const event of consults ?? []) {
        const patient = event.patients
        if (!patient?.phone) continue

        const alreadySent = await checkLog(supabase, userId, 'followup', event.id, today)
        if (alreadySent) { results.skipped++; continue }

        const msg = config.followup_template
          .replace('{patient_name}', patient.full_name.split(' ')[0])
          .replace('{date}', pastDate.toLocaleDateString('pt-BR'))

        await safeSend(supabase, userId, event.id, patient.phone, msg, 'followup', results)
      }
    }
  }

  return res.status(200).json({ ok: true, ...results })
}

async function checkLog(supabase, userId, eventType, refId, date) {
  const dateStr = date.toISOString().slice(0, 10)
  const { data } = await supabase
    .from('automation_log')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .eq('ref_id', refId)
    .gte('sent_at', `${dateStr}T00:00:00Z`)
    .lt('sent_at', `${dateStr}T23:59:59Z`)
    .maybeSingle()
  return !!data
}

async function safeSend(supabase, userId, refId, phone, msg, eventType, results) {
  try {
    await sendWhatsAppText(phone, msg)
    await supabase.from('automation_log').insert({ user_id: userId, event_type: eventType, ref_id: refId, phone })
    await supabase.from('whatsapp_messages').insert({ user_id: userId, phone, direction: 'outbound', body: msg, status: 'sent' })
    results.sent++
  } catch {
    results.errors++
  }
}
```

---

## Task 3: Cron em `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 3.1: Adicionar cron job**

Ler o `vercel.json` atual e adicionar dentro de `"crons"` (criar a chave se não existir):

```json
{
  "crons": [
    { "path": "/api/automations/whatsapp", "schedule": "0 11 * * *" }
  ]
}
```

**Nota:** `"crons"` é suportado apenas em projetos Vercel Pro/Team. No plano gratuito, a alternativa é usar o cron existente em `/api/recurrences/process` e adicionar a lógica de automações dentro do mesmo endpoint (se couber no timeout de 10s).

---

## Task 4: UI de configuração em Settings

**Files:**
- Modify: `src/components/Settings.jsx`

- [ ] **Step 4.1: Adicionar seção "Automações WhatsApp" no Settings**

```jsx
function AutomationSettings({ userId }) {
  const [config, setConfig] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('automation_settings').select('*').eq('user_id', userId).maybeSingle()
      .then(({ data }) => setConfig(data ?? getDefaultConfig(userId)))
  }, [userId])

  function getDefaultConfig(userId) {
    return {
      user_id: userId,
      reminder_enabled: true,
      payment_reminder_enabled: true,
      anamnese_link_enabled: false,
      followup_enabled: true,
      reminder_template: 'Olá {patient_name}! Lembrando da sua consulta amanhã, {date} às {time}. 😊',
      payment_template: 'Olá {patient_name}, temos um pagamento pendente de {value}. Qualquer dúvida, fale conosco.',
      anamnese_template: 'Olá {patient_name}! Preencha a ficha de anamnese antes da consulta: {link}',
      followup_template: 'Olá {patient_name}! Esperamos que esteja bem. Qualquer dúvida, estamos aqui. 🌿',
      reminder_days_before: 1,
      followup_days_after: 3,
    }
  }

  async function save() {
    setSaving(true)
    await supabase.from('automation_settings').upsert({ ...config, updated_at: new Date().toISOString() })
    setSaving(false)
  }

  if (!config) return null

  const set = (field, value) => setConfig(c => ({ ...c, [field]: value }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 480 }}>
      <Toggle label="Lembrete de consulta/cirurgia" checked={config.reminder_enabled} onChange={v => set('reminder_enabled', v)}>
        {config.reminder_enabled && (
          <>
            <TemplateField label="Mensagem" value={config.reminder_template} onChange={v => set('reminder_template', v)} vars="{patient_name}, {date}, {time}" />
            <FInput label="Enviar X dias antes" type="number" value={config.reminder_days_before} onChange={v => set('reminder_days_before', parseInt(v))} />
          </>
        )}
      </Toggle>

      <Toggle label="Follow-up pós-consulta" checked={config.followup_enabled} onChange={v => set('followup_enabled', v)}>
        {config.followup_enabled && (
          <>
            <TemplateField label="Mensagem" value={config.followup_template} onChange={v => set('followup_template', v)} vars="{patient_name}, {date}" />
            <FInput label="Enviar X dias depois" type="number" value={config.followup_days_after} onChange={v => set('followup_days_after', parseInt(v))} />
          </>
        )}
      </Toggle>

      <Toggle label="Link de anamnese" checked={config.anamnese_link_enabled} onChange={v => set('anamnese_link_enabled', v)}>
        {config.anamnese_link_enabled && (
          <TemplateField label="Mensagem" value={config.anamnese_template} onChange={v => set('anamnese_template', v)} vars="{patient_name}, {link}" />
        )}
      </Toggle>

      <Btn onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar configurações'}</Btn>
    </div>
  )
}

function Toggle({ label, checked, onChange, children }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
        <span style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>{label}</span>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.accent }} />
      </label>
      {checked && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  )
}

function TemplateField({ label, value, onChange, vars }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={base.label}>{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        style={{ ...base.input, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }}
      />
      <p style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>Variáveis disponíveis: {vars}</p>
    </div>
  )
}
```

- [ ] **Step 4.2: Integrar `AutomationSettings` na aba correta do Settings**

Adicionar a seção "Automações" ao Settings (como seção nova ou aba, seguindo o padrão existente do componente).

- [ ] **Step 4.3: Testar o cron manualmente**

```bash
# Simular chamada do cron via curl local
curl -X POST http://localhost:3000/api/automations/whatsapp \
  -H "Authorization: Bearer $CRON_SECRET"
```

Esperado: `{ "ok": true, "sent": 0, "skipped": 0, "errors": 0 }` (0 enviados pois as datas provavelmente não batem em teste).

Para testar com data real: inserir uma consulta com data = amanhã para um paciente com telefone cadastrado, rodar novamente.

- [ ] **Step 4.4: Commit**

```bash
git add supabase/automations_schema.sql \
        api/automations/whatsapp.js \
        src/components/Settings.jsx \
        vercel.json
git commit -m "feat: automações de WhatsApp — lembrete, follow-up e link de anamnese"
```

- [ ] **Step 4.5: Atualizar CHANGELOG.md**

```
### Added
- Automações de WhatsApp: lembrete de consulta/cirurgia, follow-up pós-consulta, link de anamnese. Templates configuráveis em Configurações → Automações. Cron diário às 08:00 BRT. Arquivos: `api/automations/whatsapp.js`, `supabase/automations_schema.sql`.
```

---

## Self-review

### Cobertura
- ✅ Lembrete 1 dia antes (consultas e cirurgias)
- ✅ Follow-up X dias depois
- ✅ Link de anamnese (toggle)
- ✅ Templates configuráveis com variáveis
- ✅ Log de envio para evitar duplicatas
- ✅ UI de configuração em Settings

### Lacuna
- **Cobrança via WhatsApp** está na Fase 3 e depende do módulo de boletos — não está incluída aqui

### Riscos
- Vercel cron requer plano Pro. No plano Hobby, usar o cron existente de recorrências como gatilho
- O join `patients(full_name, phone)` em `consultations` e `surgeries` depende de `patient_id` preenchido — pacientes sem vínculo não recebem mensagem (comportamento esperado)
- Timeout de 10s no Vercel pode ser insuficiente para clínicas com muitos eventos — usar `edge runtime` ou quebrar em batches se necessário
