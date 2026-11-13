# Passagem de bastão automática: Samara → Jonas ao marcar "consulta realizada"

Data: 2026-11-13

## 1. Goal

Quando uma oportunidade entra na etapa "Consultado" (consulta realizada), reatribuir automaticamente o responsável da oportunidade para quem faz a negociação (ex.: Jonas) — hoje isso é manual.

## 2. Contexto do cliente

Treinamento de 12/11/2026. Jonas descreveu a divisão real do trabalho: Samara cuida de tudo até a consulta (agendamento, confirmação); ele só pega o paciente depois que a consulta aconteceu. Felipe confirmou (13/11/2026) o gatilho exato: **"consulta realizada"** — que corresponde à etapa `consultado` do funil (`src/lib/crmStages.js`). É R04 do levantamento.

**Achado importante ao investigar o código (13/11/2026):** já existe uma "régua de follow-up" (`followup_rules`, `supabase/followup_rules_schema.sql`) que, ao entrar numa etapa, cria uma **tarefa** atribuída a alguém via trigger (`apply_followup_rules`). Mas isso só cria um lembrete — não torna a pessoa a **responsável da oportunidade** (`opportunities.responsible_user_id`), que é o que de fato move o paciente para a fila/visão do Jonas (ex.: "Meus leads", filtro por responsável). Esta spec estende essa régua existente para também poder reatribuir a oportunidade, em vez de criar um mecanismo paralelo.

## 3. Área e lugar na navegação

Configuração em **Automações & Integrações** (admin), onde já vive a tela de régua de follow-up (`src/components/FollowupRules.jsx`). O efeito (oportunidade com novo responsável) aparece em **Pacientes (CRM & Jornada)** → Funil/Tabela.

## 4. Benchmark e o que copiar

Kommo: automação no-code que avança etapa e reatribui responsável sem código por cliente — já é o espírito do `followup_rules` existente, só falta o reflexo no `responsible_user_id`.

## 5. Fluxo ideal

1. Admin (Dra. Vitória/Felipe) abre a tela de régua de follow-up e, na regra da etapa "Consultado", além do título da tarefa, marca a opção nova "Também passar a oportunidade para este responsável" e escolhe Jonas.
2. Quando Samara marca a consulta como realizada e a oportunidade entra em "Consultado" (manual ou por outra automação), o trigger já existente cria a tarefa (como já faz) **e agora também** atualiza `responsible_user_id` da oportunidade para o Jonas.
3. A oportunidade passa a aparecer nas visões "Meus leads"/filtro por responsável do Jonas, sem ele precisar que a Samara falasse com ele por fora.
4. A mudança de responsável fica registrada no histórico de campo da oportunidade (`opportunity_field_history`, já existe e já rastreia `responsible_user_id` automaticamente via trigger existente — não precisa de código novo para isso).

## 6. Modelo de dados e propagação

```sql
alter table public.followup_rules
  add column if not exists reassign_owner boolean not null default false;
```

Migration: `supabase/followup_rules_reassign_owner_schema.sql`. Ajustar `apply_followup_rules()` (função já existente em `followup_rules_schema.sql`) para, quando `r.reassign_owner = true` e `r.assigned_user_id` não for nulo, também executar:

```sql
update public.opportunities
  set responsible_user_id = r.assigned_user_id
  where id = NEW.opportunity_id;
```

Isso roda **depois** de inserir a tarefa, dentro do mesmo loop da regra — continua idempotente (se a oportunidade já tem esse responsável, o update não muda nada perceptível) e aproveita o trigger `opportunity_field_history_capture` que já existe e já audita qualquer mudança de `responsible_user_id`, sem precisar de insert manual de auditoria.

**Mapa de propagação:**

```
Oportunidade entra na etapa "consultado" (trigger trg_apply_followup_rules)
  → Tarefa criada (já existia)
  → (novo) opportunities.responsible_user_id atualizado, se a regra tiver reassign_owner=true
    → Visões "Meus leads"/filtro por responsável no CRM
    → opportunity_field_history (auditoria automática já existente)
    → NotificationBell: alerta "Sem responsável" para de disparar para essa oportunidade
```

## 7. Pontos de integração/automação

Nenhuma integração de terceiro. É uma extensão do mecanismo de automação de funil que já existe (`followup_rules` + trigger em `opportunity_stage_history`).

## 8. Permissões

Configurar a regra: só Admin (mesma tela que já é só-admin hoje). O efeito (mudança de responsável) é visível a todos que já veem a oportunidade.

## 9. Mapa de arquivos

- `supabase/followup_rules_reassign_owner_schema.sql` — criar (coluna nova + `create or replace function public.apply_followup_rules()` com a lógica adicional).
- `src/components/FollowupRules.jsx` — checkbox "Também passar a oportunidade para este responsável" no formulário da regra, junto ao campo "Responsável" que já existe.
- `CHANGELOG.md`.

## 10. Tasks

1. Criar e aplicar a migration (coluna + função atualizada).
2. Adicionar o checkbox em `FollowupRules.jsx`, reaproveitando o mesmo `assigned_user_id` já selecionado na regra (não duplicar campo de responsável).
3. Teste de integração (PGlite, seguindo o padrão já usado nas migrations de CRM): criar regra com `reassign_owner=true` na etapa `consultado`, mover uma oportunidade para essa etapa via `move_opportunity`, confirmar que `responsible_user_id` mudou e que `opportunity_field_history` registrou a mudança.
4. Confirmar que uma regra com `reassign_owner=false` (padrão) continua se comportando exatamente como hoje (só cria a tarefa, sem reatribuir) — teste de não-regressão.
5. Atualizar `CHANGELOG.md`.

## 11. Checklist de fidedignidade

1. **Soma bate?** Não aplicável — não é dado financeiro.
2. **Propagou?** Reatribuição aparece imediatamente nas visões de responsável e na auditoria de campo.
3. **As 3 datas?** Não aplicável.
4. **Sem órfão:** regras existentes continuam com `reassign_owner=false` por default — nenhuma automação hoje passa a reatribuir sem o admin marcar explicitamente.
5. **Estados de pagamento:** não aplicável.
6. **Teste automatizado:** tasks 3 e 4 (positivo e negativo).
7. Sem mock; trigger roda contra o Supabase real (ou PGlite para validação local, como já é padrão no projeto).

## 12. Testes e aceitação

- Teste de integração (PGlite) cobrindo reatribuição e não-regressão.
- Verificação manual: configurar a regra na etapa "Consultado" apontando pro Jonas, mover uma oportunidade de teste para essa etapa, confirmar que ela aparece no filtro "Meus leads" do Jonas.
- `CHANGELOG.md` atualizado no mesmo commit.
