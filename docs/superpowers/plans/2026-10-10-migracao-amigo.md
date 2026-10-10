# Migração dos Dados do Amigo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** Importar os cadastros de pacientes do app Amigo para o SurgiMetrics, de forma idempotente e auditável, sem duplicar pacientes.

**Status:** a investigar — Felipe passou a ter **acesso (login) à conta do Amigo**. Este plano começa pela investigação da exportação; as tasks de importação dependem do que o Amigo permitir exportar.

**Tech Stack:** Node (script de importação), Supabase (Postgres + RLS)

---

## Padrão e contexto (2026-10-10)

> Alinha à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`.

**Contexto do cliente:** Fase 2. A Dra. Vitória quer trazer os pacientes do Amigo. Pela resposta contratual (Ponto 2), a migração é **melhor esforço**, condicionada a o Amigo permitir exportar. O **histórico clínico antigo (anamneses/evoluções passadas) está FORA do escopo**, salvo acordo à parte.

**Área e navegação:** processo de admin, único (one-time); o resultado alimenta a área **Pacientes (CRM)**.

**Benchmark / abordagem:** ETL idempotente — importar de novo não duplica; cada paciente do Amigo mapeia para no máximo um `patients` do SurgiMetrics, por uma chave estável (CPF, ou telefone+nome quando não houver CPF).

**Fluxo ideal:** (1) exportar do Amigo (CSV/Excel/API) → (2) mapear campos → (3) importar com de-duplicação → (4) relatório do que entrou, do que foi pulado (duplicata) e do que falhou.

**Modelo de dados e propagação:**
- Alvo: tabela `patients` (ver `supabase/patients_schema.sql`). Mapear só os campos de cadastro suportados; `patient_id` nullable não quebra retrocompat.
- De-dup por chave estável. Nunca sobrescrever um paciente já cadastrado no SurgiMetrics sem confirmação.

**Pontos de integração:** o Amigo é Serviço de Terceiro (Cláusula 8); a exportação depende dele. Sem API/export, a migração não acontece (best-effort).

**Permissões:** admin.

---

## Task 0: Investigar a exportação do Amigo (com o acesso atual)

- [ ] **0.1** Entrar na conta do Amigo e verificar se há exportação de pacientes (CSV/Excel) ou API. Registrar: formato, campos disponíveis, limite de volume.
- [ ] **0.2** Exportar uma amostra real (anonimizada quando possível) para desenhar o mapa de campos.
- [ ] **0.3** Decidir a **chave de de-duplicação** (CPF preferencial; fallback telefone+nome).
- [ ] **0.4** Confirmar com a Dra. Vitória/Augusto o escopo (só cadastro, sem histórico clínico antigo).

> As tasks abaixo só começam depois da 0 — o mapa de arquivos e o script dependem do formato real do export.

## Task 1: Mapa de campos Amigo → SurgiMetrics (após 0)

- [ ] Montar a tabela de-para (campo do Amigo → campo de `patients`), marcando o que não tem destino e o que é obrigatório.

## Task 2: Script de importação idempotente (após 1)

- [ ] Script que lê o export, aplica a de-dup e insere/atualiza em `patients` via Supabase, respeitando RLS/owner. Reexecutável sem duplicar.

## Task 3: Validação e relatório

- [ ] Relatório: total lido, importados, pulados (duplicata), falhas (com motivo). Conferência da contagem com o Amigo.

---

## Checklist de fidedignidade (desta feature)

1. **Contagem bate:** nº de pacientes importados + pulados + falhas = nº exportado do Amigo.
2. **Sem duplicata:** rodar o script 2x não cria pacientes repetidos (idempotente).
3. **Campos corretos:** amostra conferida manualmente (nome, CPF, telefone, nascimento) contra o Amigo.
4. **Sem sobrescrever** paciente já existente sem confirmação.
5. **RLS/owner correto:** todos os pacientes entram sob a clínica certa, nada cross-tenant.
6. **Rollback:** há como identificar e remover o lote importado se algo der errado (ex.: marcar origem `amigo_import`).

## Aceitação

- Export obtido e mapeado; importação validada numa amostra antes do lote completo.
- `CHANGELOG.md` atualizado. Sem alterar `supabase/*` schema sem direção explícita (SYSTEM_RULES 1) — se precisar de coluna nova (ex.: `source`), pedir antes.
