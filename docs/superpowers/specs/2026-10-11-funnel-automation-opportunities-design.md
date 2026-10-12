# Automação do funil (evento → estágio) — modelo Oportunidades (design)

> CRM Fase 2 · sub-projeto 4 (fecha o motor de automação). Adapta o plano antigo
> `docs/superpowers/plans/2026-10-08-automacoes-funil.md` (que mirava `patients.funnel_stage`, hoje
> vestigial) para o modelo atual de **Oportunidades** (`opportunities.stage` + `move_opportunity`).

## 1. Objetivo
Avançar a **oportunidade** de estágio automaticamente quando um evento claro acontece, sem trabalho
manual — estilo Kommo (avança quando a condição é inequívoca).

| Evento | De → Para |
|--------|-----------|
| Consulta criada (com paciente/oportunidade) | `consulta_agendada` → `consultado` |
| Cirurgia criada | `consultado` → `orcamento_enviado` |
| Pagamento da cirurgia vira `pago`/`parcelado` | `orcamento_enviado` → `reserva_paga` |
| 3 dias após a cirurgia (futuro) | `reserva_paga` → `follow_up` (cron, fora deste incremento) |

## 2. Arquitetura
Triggers Postgres (SQL puro, **sem mudança no frontend** — o pipeline já lê `opportunities.stage`).

- `auto_advance_opportunity(opp, from, to)` (SECURITY DEFINER): `UPDATE opportunities SET stage=to
  WHERE id=opp AND stage=from AND status='aberto'`; se moveu, grava `opportunity_stage_history`
  (`source='automacao'`, `moved_by=auth.uid()`). **Forward-only** (guarda pelo `from`), **idempotente**.
- `resolve_event_opportunity(opp_id, patient_id)`: usa `opportunity_id` do evento; senão, a **única**
  oportunidade aberta do paciente (se houver exatamente uma; ambíguo → `null`, não chuta).
- Triggers fail-safe (`exception when others then null`) em `consultations` (AFTER INSERT),
  `surgeries` (AFTER INSERT) e `surgeries` (AFTER UPDATE OF payment_status) — **nunca abortam** o
  insert/update da consulta/cirurgia.

## 3. Propagação
- Escreve em `opportunities.stage` (mesma fonte do movimento manual) e em `opportunity_stage_history`
  (auditável). Como grava no history, a **régua de follow-up** (`apply_followup_rules`) dispara igual —
  tarefas nascem para qualquer caminho de mudança (manual, arrastar, IA, automação). Consistente.
- **Não** reutiliza `move_opportunity` (que levanta exceção de permissão e abortaria o evento-fonte).
  Usa função dedicada sem `raise`, escopada pela própria oportunidade.

## 4. Checklist de fidedignidade
1. **Forward-only + guarda de estágio:** só avança se a oportunidade está exatamente no `from`; nunca regride, nunca pula.
2. **Não sobrescreve manual silenciosamente:** se um humano já avançou (ou a oportunidade não está no `from`), a automação não faz nada; e toda mudança automática fica em `opportunity_stage_history` com `source='automacao'`.
3. **`reserva_paga` só com pagamento real** (`payment_status` vira `pago`/`parcelado`, com mudança de valor — guarda `IS DISTINCT FROM`).
4. **Fail-safe:** erro na automação nunca aborta o insert/update da consulta/cirurgia (`exception when others`).
5. **Sem ruído no autosave:** o re-save do dataset reupserta linhas; INSERT dispara só em linha nova; o trigger de pagamento tem guarda de mudança de valor, então upsert idêntico não re-dispara.
6. **Multi-oportunidade:** usa `opportunity_id` do evento; sem ele, só age se o paciente tem exatamente 1 oportunidade aberta.

## 5. Arquivos
| Arquivo | Ação |
|---|---|
| `supabase/funnel_automation_schema.sql` | Criar — funções + 3 triggers |

## 6. Ativação (Felipe)
Rodar `supabase/funnel_automation_schema.sql` (depois de `opportunities_schema.sql` + `opportunity_move_rpc.sql`). Sem app deploy. Toggle on/off por clínica fica como melhoria futura (hoje é seguro por ser forward-only+auditado).
