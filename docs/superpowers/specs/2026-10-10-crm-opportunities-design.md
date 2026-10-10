# CRM — Oportunidades & Pipeline (Fase 2, sub-projeto 1) — Design

> Fundação do CRM rico (benchmark Kommo). Referência de arquitetura: `docs/superpowers/specs/2026-10-10-platform-architecture-design.md` (área Pacientes). Aprovado por Felipe (10/10/2026): modelo de **Oportunidades** (um contato pode ter várias).

## Objetivo
Substituir o funil "1 estágio por paciente" (`patients.funnel_stage`) por um pipeline de **oportunidades** (negócios): um paciente (contato) pode ter N oportunidades, cada uma com estágio, valor, origem, responsável e tags. Pipeline visual estilo Kommo com card rico, movimentação auditável e totais por estágio.

## Decisões
- **Oportunidade é o card do funil** (não o paciente). Paciente = contato.
- Movimentação **auditável**: toda mudança de estágio é registrada (quem, quando, manual vs automação) — nunca sobrescreve em silêncio.
- `patients.funnel_stage` vira **vestigial** (migrado para oportunidades; o pipeline deixa de lê-lo). Fonte única = `opportunities`. (Coluna removida numa limpeza posterior, após validar.)
- Valor/faturamento real continua em `surgeries`/`consultations`, agora amarrados à oportunidade por `opportunity_id` (nullable, retrocompatível).

## Modelo de dados

```
opportunities
  id, user_id (owner), patient_id (FK → patients),
  title text,                        -- ex: "Rinoplastia — Ana"
  stage text,                        -- mesmos 5 estágios + ganho/perdido
  status text ('aberto'|'ganho'|'perdido'),
  value numeric,                     -- valor orçado/estimado
  source text,                       -- origem (Instagram, indicação, ...)
  responsible_user_id uuid,          -- quem cuida (membro da clínica)
  tags text[],                       -- etiquetas livres
  lost_reason text,                  -- quando perdido
  stage_entered_at timestamptz,      -- "parado há X dias"
  created_at, updated_at

opportunity_stage_history
  id, opportunity_id (FK), user_id,
  from_stage, to_stage,
  moved_by uuid (user),              -- quem moveu
  source text ('manual'|'automacao'),-- auditável
  created_at

surgeries / consultations
  + opportunity_id uuid (nullable FK → opportunities)
```

**Estágios:** `consulta_agendada → consultado → orcamento_enviado → reserva_paga → follow_up`, mais encerramento `ganho`/`perdido` (via `status`, fora das colunas do board ou como colunas finais — decidir no layout).

**RLS:** `user_id = data_owner_id()` em `opportunities`, `opportunity_stage_history` (membros da clínica acessam as do dono). Igual às demais tabelas.

**Migração:** cada paciente ativo com `funnel_stage` → 1 oportunidade no estágio atual (`status='aberto'`, `stage_entered_at=now()`, `title = full_name`). Preserva o funil atual.

## Fidedignidade (checklist)
1. Fonte única do estágio = `opportunities.stage`. Pipeline e automações leem/escrevem só aí (não `patients.funnel_stage`).
2. Toda mudança de estágio grava uma linha em `opportunity_stage_history` (manual ou automação) — auditável, nunca silenciosa.
3. `stage_entered_at` atualiza a cada mudança de estágio (base do "parado há X dias" e da régua de follow-up).
4. Valor da oportunidade não diverge do procedimento: quando ganha e vira cirurgia, `surgeries.opportunity_id` liga os dois; relatórios somam do registro-fonte.
5. Multi-tenant: membro vê/edita só oportunidades do dono (`data_owner_id()`), nunca cross-clínica.
6. Migração idempotente (não duplica oportunidade ao rodar 2x).

## Front-end (pipeline estilo Kommo) — layout a validar com mockup
- **Board** por estágio (colunas). Header do board: total de oportunidades e **soma de valores** por coluna; filtros (responsável, origem, tag, faixa de valor).
- **Card rico:** nome do paciente + título, valor, origem, tags, avatar/inicial do responsável, "há X dias no estágio", atalho WhatsApp.
- **Mover:** drag-and-drop (`dnd-kit`) + fallback por menu (mobile/testabilidade). Mover grava histórico.
- **Drawer da oportunidade:** detalhes + timeline (sub-projeto 2) + paciente vinculado + chat WhatsApp.
- Área: **Pacientes** (o pipeline substitui o "Funil" atual). Acesso: todos os perfis (CRM é de todos); valores sensíveis respeitam o que o perfil pode ver.

## Incrementos
1a. Modelo de dados + migração (SQL) — este passo.
1b. Pipeline lê oportunidades (reescreve `PatientFunnel` → `OpportunityPipeline`), card rico, mover por menu + histórico.
1c. Drag-and-drop, filtros, totais por coluna.

## Fora do escopo (sub-projeto 1)
- Timeline e tarefas (sub-projeto 2).
- Automação de movimentação (sub-projeto 4) — aqui só o histórico/estrutura que a automação vai usar.
- Múltiplos pipelines (um só por enquanto).
