# Spec — Tarefas + Timeline da oportunidade (CRM, Fase 2 · sub-projeto 2a)

**Data:** 2026-10-11
**Pediu:** Felipe (transformar o pipeline em rotina; preparar terreno pras automações).
**Decisões aprovadas:** nota manual **sim**; painel "Tarefas de hoje" cross-oportunidade fica pro **2c**; tarefas podem ser **avulsas** (schema geral — ligadas a oportunidade, a paciente, ou soltas).

## Decomposição do sub-projeto 2

- **2a — Tarefas + Timeline** *(esta spec)*: tabela de tarefas geral + CRUD dentro da oportunidade; timeline derivada + nota manual.
- **2b — Régua de follow-up**: modelos de sequência que geram tarefas automaticamente (depende de 2a).
- **2c — Painel "Tarefas de hoje"**: lista cross-oportunidade (ver/criar avulsas, agenda do dia da equipe).

## Objetivo (2a)

No editor da oportunidade, adicionar duas abas além de **Dados**:
1. **Tarefas** — criar/concluir tarefas (título, vencimento, responsável) ligadas à oportunidade.
2. **Timeline** — linha do tempo do que aconteceu (estágio, WhatsApp, tarefas, ganho/perdido, criação) + **nota manual**.

## Não-objetivos (YAGNI)

- Painel cross-oportunidade / "tarefas de hoje" (é 2c).
- Régua/automação de tarefas (é 2b).
- Lembrete por WhatsApp a partir da tarefa (é o sub-projeto 4, automações de saída).
- Notificações/push.

## Dados (SQL — `supabase/tasks_timeline_schema.sql`)

**`tasks`** — geral, pra suportar avulsas (nullable em opportunity_id e patient_id):
```
id, user_id (dono/clínica, not null),
opportunity_id uuid null → opportunities on delete cascade,
patient_id uuid null → patients on delete set null,
title text not null,
due_date date null,
status text not null default 'pendente' check (pendente|feita),
assigned_user_id uuid null → auth.users,
created_by uuid null → auth.users,
done_at timestamptz null,
created_at, updated_at
```
RLS `for all using user_id = data_owner_id()`. Índices: `(user_id, status, due_date)`, `(opportunity_id)`, `(assigned_user_id, status)`.

**`opportunity_notes`** — notas manuais (único "evento" sem fonte própria, logo precisa storage):
```
id, user_id (clínica, not null),
opportunity_id uuid not null → opportunities on delete cascade,
body text not null,
author_id uuid null → auth.users,
created_at timestamptz
```
RLS `for all using user_id = data_owner_id()`. Índice `(opportunity_id, created_at desc)`.

## Timeline = derivada (fonte única, sem duplicar evento)

A timeline **não** é uma tabela de eventos; é montada no cliente mesclando o que já é verdade:
- `opportunity_stage_history` → "movida p/ X" (mostra manual/automação e quem).
- `whatsapp_messages` (do `patient_id`) → mensagens enviadas/recebidas.
- `tasks` da oportunidade → criada / concluída.
- `opportunity.created_at` → "oportunidade criada"; `status` ganho/perdido → "fechada".
- `opportunity_notes` → nota manual.

Função **pura** `buildTimeline({ opp, stageHistory, messages, tasks, notes })` → lista de eventos `{ at, kind, icon, text, meta }` ordenada desc. Testável em unidade — é a peça de fidedignidade (a timeline nunca inventa nem diverge da fonte).

## Arquitetura

| Unidade | Arquivo | Responsabilidade |
|---|---|---|
| Timeline pura | `src/lib/timeline.js` | `buildTimeline(...)` (sem I/O, testada) |
| Ações | `src/lib/taskActions.js` | `createTask`, `toggleTask`, `deleteTask`, `addNote` |
| Aba Tarefas | `src/components/OpportunityTasks.jsx` | lista + criar + concluir |
| Aba Timeline | `src/components/OpportunityTimeline.jsx` | carrega as fontes, `buildTimeline`, campo de nota |
| Editor | `src/components/OpportunityEditor.jsx` | abas Dados / Tarefas / Timeline (abas só no editar) |

## UI

Editor vira abas no topo: **Dados | Tarefas | Timeline** (Tarefas/Timeline só aparecem ao editar — numa oportunidade já existente). Rodapé (Salvar / Ganho / Perdido) só na aba Dados.

- **Tarefas:** lista com checkbox (concluir → `status='feita'`, `done_at`), vencimento (destaque se atrasada), responsável (da equipe). Form inline: título + vence + responsável.
- **Timeline:** eventos com ícone + texto + quando/quem. Topo: campo "registrar nota" → `addNote` → aparece na hora.

## Mapa de propagação

Tarefas e notas são **operacionais** — não tocam caixa/DRE/metas/dashboard. Timeline é leitura derivada (nenhuma escrita). Estágio continua mudando só pela RPC auditada. Deletar tarefa/nota não afeta nada financeiro.

## Checklist de fidedignidade

- [x] Timeline derivada das fontes reais (sem tabela de evento paralela que possa divergir).
- [x] `tasks`/`notes` com RLS por `data_owner_id()` (clínica).
- [x] Nenhum total/KPI financeiro tocado.
- [x] Concluir tarefa é idempotente (status + done_at); otimismo com rollback em erro.

## Testes

- `tests/unit/timeline.spec.js`: `buildTimeline` mescla e ordena as fontes; nota/tarefa/estágio/mensagem viram eventos; ordenação desc; vazio → só "criada".
- Build limpo + unit suite verde.
- e2e: abas Tarefas/Timeline aparecem no editar e permitem adicionar uma tarefa (mock de insert), no padrão dos specs de pipeline.

## Decisões confirmadas

- Nota manual **incluída**.
- Painel cross-oportunidade → **2c** (depois).
- `tasks` **geral** (avulsas suportadas no schema; UI avulsa vem no 2c).
