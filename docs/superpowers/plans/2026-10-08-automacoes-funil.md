# Automações de Movimentação no Funil — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover pacientes automaticamente entre estágios do funil com base em eventos do sistema (consulta criada → "consultado", pagamento registrado → "reserva paga") sem intervenção manual.

**Pré-requisito:** O plano `2026-10-08-patient-funnel.md` deve estar implementado (coluna `funnel_stage` existe na tabela `patients`).

**Architecture:** Database triggers no Supabase (Postgres functions + triggers) que atualizam `funnel_stage` automaticamente quando eventos ocorrem. Nenhuma lógica nova no frontend — os triggers rodam no banco, transparente para o usuário.

**Regras de movimentação:**
| Evento | Estágio destino | Condição |
|--------|----------------|----------|
| Consulta criada/atualizada com `patient_id` | `consultado` | Se estava em `consulta_agendada` |
| Cirurgia criada com `patient_id` | `orcamento_enviado` | Se estava em `consultado` |
| Pagamento em cirurgia: `payment_status = 'paid'` parcial/total e valor reserva | `reserva_paga` | Se estava em `orcamento_enviado` |
| 3 dias após cirurgia realizada | `follow_up` | Se estava em `reserva_paga` |

**Tech Stack:** Postgres triggers (Supabase SQL Editor)

---

## Padrão e contexto (atualizado 2026-10-10)

> Alinha o plano à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`. As Tasks e a tabela de regras acima continuam válidas.

**Contexto do cliente:** Fase 2. Mover o paciente de estágio automaticamente por evento, sem trabalho manual.

**Área e navegação:** regras na área **Automações & Integrações** (admin); o efeito aparece no **Funil** (área Pacientes).

**Benchmark (o que copiar):** Kommo — automação que avança a etapa quando a condição é clara.

**Modelo de dados e propagação (ponto crítico):**
- Triggers Postgres atualizam `patients.funnel_stage` — a **mesma fonte** que o movimento manual do funil. Por isso: só avança se estava no estágio anterior esperado (guarda já na tabela de regras), **nunca regride** um estágio, e a mudança automática é **auditável** (registrar origem `auto`).
- `reserva_paga` depende do `payment_status`/valor correto da cirurgia; `consultado` depende de consulta com `patient_id`. Ler o estado real, não um proxy.

**Permissões:** configurar regras = só admin; o efeito é visível a todos no funil.

**Checklist de fidedignidade (desta feature):**
1. Trigger **idempotente** e com guarda de estágio anterior — não pula nem regride etapas.
2. Não sobrescreve um estágio movido manualmente de forma deliberada sem registro (origem auditável).
3. `reserva_paga` só dispara com pagamento real registrado; coerente com o Financeiro.
4. Alterar/excluir o evento-fonte (consulta/cirurgia) não deixa o estágio órfão/divergente.
5. Teste cobre cada regra da tabela, incluindo o caso "evento ocorre mas o estágio não era o esperado".

---

## Referências obrigatórias

- `supabase/patient_funnel_schema.sql` — coluna `funnel_stage` em `patients`
- `supabase/erp_relational_schema.sql` — estrutura das tabelas `consultations` e `surgeries`
- `supabase/patients_schema.sql` — tabela `patients`

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/funnel_automation_schema.sql` | Criar | Funções e triggers de movimentação automática |

---

## Task 1: Inspecionar estrutura de `surgeries` e `consultations`

Antes de escrever os triggers, confirmar os nomes das colunas relevantes.

- [ ] **Step 1.1: Verificar colunas existentes**

No Supabase SQL Editor:

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'surgeries' and table_schema = 'public'
order by ordinal_position;
```

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'consultations' and table_schema = 'public'
order by ordinal_position;
```

Anotar: nome da coluna de status de pagamento (ex: `payment_status`), coluna de data (ex: `date`), coluna de reserva (ex: `deposit_paid`). Ajustar o SQL dos triggers nos steps seguintes se os nomes forem diferentes.

---

## Task 2: Triggers de movimentação

**Files:**
- Create: `supabase/funnel_automation_schema.sql`

- [ ] **Step 2.1: Criar função helper de movimentação**

```sql
-- funnel_automation_schema.sql
-- Executar DEPOIS de patient_funnel_schema.sql.

-- Move o paciente para um novo estágio apenas se estiver no estágio esperado.
-- Isso evita regressões: não move para trás na jornada.
create or replace function public.advance_funnel_stage(
  p_patient_id uuid,
  p_from_stage text,
  p_to_stage text
) returns void language plpgsql as $$
begin
  update public.patients
  set funnel_stage = p_to_stage
  where id = p_patient_id
    and funnel_stage = p_from_stage;
end;
$$;
```

- [ ] **Step 2.2: Trigger em `consultations` → avança para "consultado"**

```sql
-- Quando uma consulta é criada ou atualizada com um patient_id,
-- mover o paciente de 'consulta_agendada' para 'consultado'.

create or replace function public.trg_consultation_to_consultado()
returns trigger language plpgsql as $$
begin
  if NEW.patient_id is not null then
    perform public.advance_funnel_stage(
      NEW.patient_id,
      'consulta_agendada',
      'consultado'
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_consultation_advance_funnel on public.consultations;
create trigger trg_consultation_advance_funnel
  after insert or update of patient_id on public.consultations
  for each row execute function public.trg_consultation_to_consultado();
```

- [ ] **Step 2.3: Trigger em `surgeries` INSERT → avança para "orcamento_enviado"**

```sql
-- Quando uma cirurgia é agendada para o paciente,
-- mover de 'consultado' para 'orcamento_enviado'.

create or replace function public.trg_surgery_to_orcamento()
returns trigger language plpgsql as $$
begin
  if NEW.patient_id is not null then
    perform public.advance_funnel_stage(
      NEW.patient_id,
      'consultado',
      'orcamento_enviado'
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_surgery_advance_funnel on public.surgeries;
create trigger trg_surgery_advance_funnel
  after insert on public.surgeries
  for each row execute function public.trg_surgery_to_orcamento();
```

- [ ] **Step 2.4: Trigger de pagamento → "reserva_paga"**

**Nota:** O nome exato da coluna de status de pagamento precisa ser confirmado no Step 1.1. O exemplo abaixo usa `payment_status` e `deposit_paid` — ajustar se necessário.

```sql
-- Quando o pagamento de reserva (depósito) é confirmado,
-- mover de 'orcamento_enviado' para 'reserva_paga'.

create or replace function public.trg_surgery_payment_to_reserva()
returns trigger language plpgsql as $$
begin
  -- Ajustar condição conforme a coluna real de pagamento.
  -- Exemplo: se payment_status = 'paid' ou deposit_paid = true.
  if NEW.patient_id is not null
     and (NEW.payment_status = 'paid' OR NEW.payment_status = 'partial')
     and (OLD.payment_status IS DISTINCT FROM NEW.payment_status)
  then
    perform public.advance_funnel_stage(
      NEW.patient_id,
      'orcamento_enviado',
      'reserva_paga'
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_surgery_payment_funnel on public.surgeries;
create trigger trg_surgery_payment_funnel
  after update of payment_status on public.surgeries
  for each row execute function public.trg_surgery_payment_to_reserva();
```

- [ ] **Step 2.5: Trigger de follow-up automático via cron (alternativa)**

O trigger de "3 dias após cirurgia" não pode ser feito com trigger Postgres puro (não há clock). Duas opções:

**Opção A (recomendada):** Adicionar ao cron diário de recorrências (`api/recurrences/process`) a verificação de cirurgias de 3 dias atrás:

```js
// Adicionar no final do handler de recurrences/process existente:
const threeDaysAgo = new Date()
threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
const threeDaysAgoStr = threeDaysAgo.toISOString().slice(0, 10)

const { data: surgeries } = await supabase
  .from('surgeries')
  .select('patient_id, patients!inner(funnel_stage)')
  .eq('date', threeDaysAgoStr)
  .eq('patients.funnel_stage', 'reserva_paga')
  .not('patient_id', 'is', null)

for (const surgery of surgeries ?? []) {
  if (surgery.patient_id) {
    await supabase.from('patients').update({ funnel_stage: 'follow_up' })
      .eq('id', surgery.patient_id).eq('funnel_stage', 'reserva_paga')
  }
}
```

**Opção B:** Deixar manual (mover para "follow-up" manualmente no kanban).

- [ ] **Step 2.6: Aplicar os triggers no Supabase**

Executar o SQL completo do arquivo no SQL Editor. Verificar que não há erros.

Confirmar que os triggers existem:

```sql
select trigger_name, event_manipulation, event_object_table
from information_schema.triggers
where trigger_schema = 'public' and trigger_name like 'trg_%funnel%';
```

Esperado: 3 linhas (`trg_consultation_advance_funnel`, `trg_surgery_advance_funnel`, `trg_surgery_payment_funnel`).

---

## Task 3: Testar os triggers

- [ ] **Step 3.1: Testar trigger de consulta**

```sql
-- Criar um paciente em 'consulta_agendada' (default) e inserir uma consulta.
-- Substituir UUIDs reais.
insert into public.consultations (user_id, patient_id, date, payment_status)
values ('<user_id>', '<patient_id>', current_date, 'pending');

-- Verificar que o funnel_stage mudou.
select id, full_name, funnel_stage from public.patients where id = '<patient_id>';
```

Esperado: `funnel_stage = 'consultado'`

- [ ] **Step 3.2: Testar trigger de cirurgia**

```sql
-- Garantir que o paciente está em 'consultado' antes.
update public.patients set funnel_stage = 'consultado' where id = '<patient_id>';

insert into public.surgeries (user_id, patient_id, date, payment_status, total_price)
values ('<user_id>', '<patient_id>', current_date + 30, 'pending', 5000);

select funnel_stage from public.patients where id = '<patient_id>';
```

Esperado: `funnel_stage = 'orcamento_enviado'`

- [ ] **Step 3.3: Testar trigger de pagamento**

```sql
-- Garantir que o paciente está em 'orcamento_enviado'.
update public.patients set funnel_stage = 'orcamento_enviado' where id = '<patient_id>';

update public.surgeries set payment_status = 'paid' where patient_id = '<patient_id>';

select funnel_stage from public.patients where id = '<patient_id>';
```

Esperado: `funnel_stage = 'reserva_paga'`

- [ ] **Step 3.4: Testar no browser**

```bash
npm run dev
```

1. Criar uma nova consulta para um paciente em "Consulta Agendada"
2. Ir para o Funil → confirmar que o paciente moveu para "Consultado"

- [ ] **Step 3.5: Commit**

```bash
git add supabase/funnel_automation_schema.sql
git commit -m "feat: triggers de movimentação automática no funil por eventos do sistema"
```

- [ ] **Step 3.6: Atualizar CHANGELOG.md**

```
### Added
- Automações de funil: triggers Postgres movem pacientes automaticamente entre estágios ao criar consulta (→ consultado), cirurgia (→ orçamento enviado) e confirmar pagamento (→ reserva paga). Arquivo: `supabase/funnel_automation_schema.sql`.
```

---

## Self-review

### Cobertura
- ✅ Consulta → "consultado"
- ✅ Cirurgia agendada → "orçamento enviado"
- ✅ Pagamento confirmado → "reserva paga"
- ✅ Follow-up via cron (Opção A)

### Riscos
- O nome da coluna `payment_status` precisa ser verificado (Step 1.1) — o trigger pode não compilar se o nome for diferente
- Os triggers usam `advance_funnel_stage` que só avança — nunca regride. Um paciente em "follow_up" não voltará para "consultado" se uma nova consulta for inserida para ele (comportamento correto)
- O join `patients!inner(funnel_stage)` no cron (Opção A) usa sintaxe de join do PostgREST — confirmar que funciona com a versão do `@supabase/supabase-js` em uso
