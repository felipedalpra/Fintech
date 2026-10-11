# Spec — Painel "Tarefas" cross-oportunidade (CRM, Fase 2 · sub-projeto 2c)

**Data:** 2026-10-11
**Pediu:** Felipe. **Decisões aprovadas:** item em **Pacientes → Tarefas**, visível a todos; é aqui que se veem/criam as **tarefas avulsas**.

## Objetivo

Uma página única com todas as tarefas da clínica (de qualquer oportunidade + avulsas), agrupadas por vencimento — a "agenda do dia" da equipe. Criar tarefa avulsa, concluir, excluir.

## Não-objetivos (YAGNI)

- Régua/automação (é 2b).
- Deep-link abrindo o card específico da oportunidade (por ora só rótulo do vínculo).
- Notificações/push.

## Dados (sem SQL novo)

Usa a tabela `tasks` já criada no 2a (geral: `opportunity_id`/`patient_id` nullable). RLS por `data_owner_id()` → o select já volta só as tarefas da clínica.

## Arquitetura

| Unidade | Arquivo | Responsabilidade |
|---|---|---|
| Agrupamento puro | `src/lib/taskGroups.js` | `groupTasksByDue(tasks, today)` → atrasadas/hoje/semana/futuras (testável) |
| Página | `src/components/TasksPanel.jsx` | carrega tarefas da clínica + membros, filtro Minhas/Todas, criar avulsa, concluir/excluir |
| Nav/rotas | `FinanceWorkspace.jsx` | item `tarefas` em Pacientes; `PAGES.tarefas` |
| Acesso | `UserRoleContext.jsx` | `tarefas` liberado a todos os perfis |

Reusa `createTask`/`toggleTask`/`deleteTask` do 2a e `PatientSelector` (avulsa com paciente opcional).

## UI

- Topo: filtro **Minhas / Todas** (default por papel: admin/gestão→Todas, equipe/concierge→Minhas) + **+ Nova tarefa avulsa** (Modal: título, vence, responsável, paciente opcional).
- Lista agrupada: **⚠ Atrasadas**, **📅 Hoje**, **🗓 Esta semana**, **📋 Futuras / sem data**. Concluídas num bloco recolhido no fim.
- Linha: checkbox (concluir), título, vencimento, responsável, **vínculo** (título da oportunidade ou nome do paciente, ou "avulsa").

## Mapa de propagação

Tarefas são operacionais — não tocam caixa/DRE/metas. Página só lê/escreve `tasks`. Concluir = status+done_at (idempotente, otimista com rollback).

## Checklist de fidedignidade

- [x] RLS por clínica já cobre o select (sem vazar entre clínicas).
- [x] Nenhum total financeiro tocado.
- [x] Agrupamento é função pura testada (não erra atrasada/hoje por fuso).

## Testes

- `tests/unit/taskGroups.spec.js`: `groupTasksByDue` classifica atrasada/hoje/semana/futura e ignora concluídas.
- Build limpo + unit verde.
- e2e: página abre em `/app/tarefas`, mostra filtro e botão de nova tarefa avulsa (mock de `tasks` GET).
