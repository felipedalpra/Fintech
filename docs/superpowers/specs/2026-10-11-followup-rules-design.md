# Spec — Régua de follow-up (CRM, Fase 2 · sub-projeto 2b)

**Data:** 2026-10-11
**Decisões aprovadas:** dispara por **trigger no banco** (automático em qualquer caminho de mudança de estágio); config em **Configurações → Régua de follow-up** (admin).

## Objetivo

O admin define **modelos de tarefa por estágio**. Quando a oportunidade **entra** num estágio, as tarefas nascem automaticamente (com vencimento = dia da entrada + N dias). É o elo direto com as automações de saída (sub-projeto 4): a régua cria a tarefa "mandar lembrete"; o motor de WhatsApp depois dispara a mensagem.

## Não-objetivos (YAGNI)

- Disparo por WhatsApp (é o sub-projeto 4).
- Condições além de "entrou no estágio X" (sem filtros por origem/valor por ora).
- Reprocessar histórico retroativo.

## Como dispara (trigger no banco)

Toda mudança de estágio grava uma linha em `opportunity_stage_history` (via RPC `move_opportunity`, para qualquer caminho: manual, arrastar, IA-confirmada, automação). Um **trigger AFTER INSERT** nessa tabela lê as regras ativas do dono para o `to_stage` e cria as tarefas — sem cron, sem credencial, à prova de caminho.

**Sem duplicar:** cada regra gera no máx. 1 tarefa por oportunidade — a tarefa guarda `origin_rule_id`; se já existe `(opportunity_id, origin_rule_id)`, o trigger pula. Reentrar no estágio não recria.

## Dados (SQL — `supabase/followup_rules_schema.sql`)

**`followup_rules`:** `id, user_id (clínica), stage, title, offset_days int default 0, assigned_user_id null, active bool default true, created_at`. RLS `for all using user_id = data_owner_id()`.

**`tasks`:** `+ origin_rule_id uuid null → followup_rules on delete set null` (marca a tarefa gerada pela régua).

**Função `apply_followup_rules()` (SECURITY DEFINER) + trigger** `after insert on opportunity_stage_history`: resolve `patient_id` da oportunidade, percorre as regras ativas `(user_id = NEW.user_id, stage = NEW.to_stage)` e insere a tarefa se ainda não existe pela regra.

## Arquitetura

| Unidade | Arquivo | Responsabilidade |
|---|---|---|
| Schema + trigger | `supabase/followup_rules_schema.sql` | tabela, coluna, função, trigger |
| Config (admin) | `src/components/FollowupRules.jsx` | CRUD das regras por estágio |
| Aba | `src/components/Settings.jsx` | aba "Régua de follow-up" (admin) |

A criação da tarefa é **100% no banco** (trigger) — o front só administra as regras.

## UI (admin)

Configurações → **Régua de follow-up**: regras agrupadas por estágio. Form: estágio, título da tarefa, "+N dias" para o vencimento, responsável (opcional, da equipe), ativo. Ligar/desligar e excluir regra.

## Mapa de propagação

Régua só cria **tarefas** (operacional) — não toca caixa/DRE/metas. O trigger age sobre `opportunity_stage_history` (já gravado pela RPC auditada) sem alterar estágio nem nada financeiro. Desligar/excluir regra não mexe nas tarefas já criadas.

## Checklist de fidedignidade

- [x] Trigger idempotente por `(opportunity_id, origin_rule_id)` — não duplica tarefa.
- [x] `followup_rules` com RLS por clínica; trigger SECURITY DEFINER cria a tarefa do dono correto (`NEW.user_id`).
- [x] Nenhum total financeiro tocado; estágio continua mudando só pela RPC.
- [x] Funciona para todos os caminhos de mudança de estágio (manual/drag/IA/automação) porque escuta a fonte única (`opportunity_stage_history`).

## Testes

- Build limpo + unit verde (lógica é no banco; sem unit nova).
- e2e: aba "Régua de follow-up" aparece pro admin em Configurações e mostra o formulário de nova regra (mock de `followup_rules` GET).
- Verificação manual do trigger (Felipe): mover uma oportunidade e conferir a tarefa criada.
