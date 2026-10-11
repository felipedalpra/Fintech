# WhatsApp — Automações de saída (design)

> CRM Fase 2 · sub-projeto 4 (parte 2). Complementa a IA que **sugere** avanço de estágio
> (`2026-10-11-whatsapp-ai-suggest-design.md`) e a régua de follow-up
> (`2026-10-11-followup-rules-design.md`). Contexto de arquitetura:
> `2026-10-10-platform-architecture-design.md`.

## 1. Problema / pedido

A clínica quer **mensagens automáticas de WhatsApp** disparadas por eventos do calendário e do
financeiro, sem alguém lembrar de mandar na mão:

1. **Lembrete** de consulta/cirurgia (N dias antes).
2. **Follow-up** pós-consulta (N dias depois).
3. **Cobrança** de pagamento pendente (no **vencimento** real).
4. **Link de anamnese** antes da consulta.

Filosofia do Felipe (ver `feedback-crm-depth-pace`): **pronto-pra-credencial** — todo o motor
(regras, templates, agendamento, dedupe, log) existe e é testável **agora**; o envio real
acende sozinho no momento em que a clínica cadastra um número Z-API com credenciais.

## 2. Restrições técnicas que moldam o design (decididas, não negociáveis)

- **Vercel Hobby: 12/12 funções serverless (no teto).** Proibido criar `api/automations/*.js`
  (seria a 13ª função). O código novo de servidor **reusa** o endpoint consolidado
  `api/whatsapp.js` (novo `?action=dispatch`) e vive em `api/_lib/whatsappAutomations.js`.
- **Crons já no teto do Hobby (2):** `recurrences/process` (06:05 UTC) e `alerts/process`
  (11:00 UTC = **08:00 BRT**). Proibido adicionar um 3º cron. O disparo diário das automações
  é **pendurado no cron que já existe** (`alerts/process`), com chamada **fail-safe** no fim
  (nunca derruba os alertas). `?action=dispatch` fica como gatilho manual/teste (sem cron novo).
- **Envio idempotente:** a mesma automação não pode disparar 2x para o mesmo evento/dia.
- **Fuso:** datas de evento são comparadas em **America/Sao_Paulo**. Às 08:00 BRT a data UTC
  e a BRT coincidem, então reusar o `today` do cron de alertas é seguro.

## 3. Arquitetura

```
cron diário (alerts/process, 08:00 BRT)
        │  (chamada fail-safe no fim do handler)
        ▼
runWhatsAppAutomations(admin, { todayISO })        ← api/_lib/whatsappAutomations.js
        │  por dono (whatsapp_automations)
        ├─ resolve número de envio (whatsapp_numbers) → sem credencial = NÃO envia (skip)
        ├─ LEMBRETE: eventos com date = hoje + days_before
        ├─ FOLLOW-UP: consultas com date = hoje − days_after
        │     planReminders()/planFollowups()  ← funções PURAS (testadas)
        │     renderTemplate()                 ← {patient_name} {date} {time}
        ▼
dispatchOne(): guarda no log (índice único) → envia (sendWhatsAppText) → grava whatsapp_messages
```

- **`api/whatsapp.js`** ganha `?action=dispatch` (autorizado por `CRON_SECRET`) para rodar o
  motor manualmente (debug/QA), opcionalmente com `?date=YYYY-MM-DD`.
- **Configuração** (admin) em **Configurações → Automações**: toggles, templates, timing,
  número de envio. 1 linha por clínica em `whatsapp_automations`.

## 4. Modelo de dados

**`whatsapp_automations`** (1 por dono, RLS por `data_owner_id()`):
`user_id` (unique), `whatsapp_number_id` (número de envio, FK nullable),
`reminder_enabled`/`reminder_days_before`/`reminder_template`,
`followup_enabled`/`followup_days_after`/`followup_template`, `updated_at`.
**Toggles nascem `false`** — nada dispara até o admin ligar (sem surpresa de mensagem).

**`whatsapp_automation_log`** (dedupe + auditoria):
`user_id`, `automation_type` (`reminder`|`followup`), `ref_type` (`consultation`|`surgery`),
`ref_id`, `target_date`, `phone`, `status` (`pending`|`sent`|`failed`).
**Índice único `(user_id, automation_type, ref_id, target_date)`** → garante envio único
mesmo com re-execução do cron. Guard-log **antes** de enviar (insere `pending`; 23505 = já tratado → skip).

Fontes (somente leitura): `consultations.date`/`start_time`/`patient_id`,
`surgeries.date`/`start_time`/`patient_id`, `patients.full_name`/`phone`,
`whatsapp_numbers.instance_url`/`api_token`.

## 5. Mapa de propagação (o que muda aqui muda onde?)

| Toca | Deriva / afeta | Garantia |
|------|----------------|----------|
| Envio de automação | Grava em `whatsapp_messages` (outbound) → aparece no **inbox** e na **timeline** da oportunidade | reusa a mesma tabela; nada paralelo |
| `whatsapp_automation_log` | **Só dedupe/auditoria** — NÃO entra em caixa/DRE/metas | automação é comunicação, não registro-fonte financeiro |
| Config de automação | Nenhum total financeiro | lembrete/follow-up não leem valor; cobrança (4b-2) lê **vencimento**, nunca competência/caixa |
| Leitura de eventos | Não altera cirurgias/consultas | motor é **read-only** nas fontes |

**Nada de financeiro é tocado neste incremento (4b-1).** Lembrete e follow-up são puramente de
calendário. Caixa/DRE/contas/metas/dashboard **não derivam** de `whatsapp_automations*`.

## 6. Checklist de fidedignidade (desta feature)

1. **Idempotência:** índice único impede 2º envio do mesmo evento/tipo/dia (guard-log antes de enviar). ✅ teste
2. **Fuso:** data-alvo calculada em BRT; `addDays` sobre `YYYY-MM-DD` sem drift de timezone. ✅ teste
3. **Toggle desligado = não envia.** Sem número com credencial = não envia (skip), mas a regra fica salva. ✅ teste
4. **Sem telefone / sem paciente vinculado = pula** (não tenta, não quebra). ✅ teste
5. **Fail-safe:** erro nas automações **nunca** derruba o cron de alertas nem o recebimento. ✅ try/catch por dono e no fold
6. (4b-2) **Cobrança lê o vencimento** (`forecast_payment_date`/`due_date`), nunca competência nem caixa; **pago não cobra** (checar `payment_status` no disparo).

## 7. Arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|------------------|
| `supabase/whatsapp_automations_schema.sql` | Criar | `whatsapp_automations` + `whatsapp_automation_log` + RLS + índice único |
| `api/_lib/whatsappAutomations.js` | Criar | Puro (`addDays`, `renderTemplate`, `planReminders`, `planFollowups`) + orquestração (`runWhatsAppAutomations`) |
| `api/whatsapp.js` | Modificar | `?action=dispatch` (gatilho manual, `CRON_SECRET`) |
| `api/alerts/process.js` | Modificar | Chamada fail-safe de `runWhatsAppAutomations` no fim do cron |
| `src/components/WhatsAppAutomations.jsx` | Criar | UI admin: toggles, templates, timing, número |
| `src/components/Settings.jsx` | Modificar | Aba **Automações** (admin) |
| `tests/unit/whatsappAutomations.spec.js` | Criar | Testa as funções puras + fidedignidade |

## 8. Decomposição

- **4b-1 (ESTE incremento): fundação + lembrete + follow-up.** Motor, schema, dedupe, UI,
  cron pendurado, `?action=dispatch`, testes puros. Pronto-pra-credencial.
- **4b-2: cobrança no vencimento.** Lê contas a receber pelo **vencimento** (regime correto),
  só para `payment_status` pendente; `{value}` no template. Fidelidade-crítica (financeiro).
- **4b-3: link de anamnese.** Depende de um mecanismo de link/token de anamnese (a desenhar).

## 9. Ativação (ações do Felipe)

1. Rodar `supabase/whatsapp_automations_schema.sql` (depois de `whatsapp_numbers_schema.sql`).
2. Garantir `CRON_SECRET` na Vercel (já usado pelo cron de alertas).
3. Em **Configurações → Automações**: escolher o número, ligar os toggles, ajustar templates/timing.
4. (Confirmar) O disparo diário usa o cron de alertas (08:00 BRT). Se a clínica migrar para
   Vercel Pro, dá pra trocar por um cron dedicado `/api/whatsapp?action=dispatch` em 1 linha.

## 10. Riscos / regressão

- **Alterar `api/alerts/process.js`** (SYSTEM_RULES #2): mitigado por try/catch — a automação é o
  último passo e falha isolada; os alertas seguem intactos.
- **Timeout de 10s do serverless:** clínica pequena, poucos eventos/dia; se crescer, paginar por dono.
- **Mensagem fora da janela de 24h no WhatsApp oficial** exige template aprovado (contrato, ponto 8).
  Com Z-API (não-oficial) não se aplica, mas fica registrado.
