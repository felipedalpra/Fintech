# Spec — Pipeline completo: criar/editar, arrastar, filtros, ganho/perdido (CRM, Fase 2 · sub-projeto 1c)

**Data:** 2026-10-11
**Pediu:** Felipe (fechar o CRM por dentro antes das automações).
**Decisões aprovadas:** arrastar via **HTML5 nativo** (zero dependência nova); **Ganho/Perdido incluído** agora.

## Problema

O pipeline (`OpportunityPipeline`) só lê oportunidades já existentes (migradas ou criadas pelo lead automático do WhatsApp). Não dá para **criar** nem **editar** uma oportunidade pela tela, não há **filtros**, mover é só pelo `<select>`, e não existe forma de **fechar** uma oportunidade (ganho/perdido) — então o board vira lista infinita.

## Objetivo

Deixar o pipeline usável no dia a dia da Lunara/Jonas:
1. **Criar** oportunidade (botão "+ Nova oportunidade"), escolhendo ou cadastrando o paciente na hora (reusa `PatientSelector`).
2. **Editar** (clicar no card abre modal com os campos).
3. **Arrastar** card entre colunas (HTML5 nativo) — move pela RPC `move_opportunity` (auditada), igual ao `<select>`, que continua como alternativa.
4. **Filtrar**: busca por paciente, responsável, origem, tag — tudo no cliente.
5. **Fechar** como **Ganho** ou **Perdido** (com motivo) — sai do board.

## Não-objetivos (YAGNI)

- Biblioteca de DnD (dnd-kit) — nativo basta no desktop.
- Reabrir oportunidade ganha/perdida pela UI (fica pra depois; dá pra fazer no banco).
- Campos novos no schema — tudo já existe em `opportunities`.
- Mexer em financeiro/agenda.

## Arquitetura

| Unidade | Arquivo | Responsabilidade |
|---|---|---|
| Ações de dados | `src/lib/opportunityActions.js` | `createOpportunity`, `updateOpportunity`, `setOpportunityOutcome` (wrappers Supabase) |
| Editor (modal) | `src/components/OpportunityEditor.jsx` | criar/editar + ganho/perdido; reusa `PatientSelector`, `Modal`, `FInput`, `Btn` |
| Pipeline | `src/components/OpportunityPipeline.jsx` | barra de filtros + botão criar, DnD nativo nas colunas, abre o editor |

Mover de estágio continua **só** pela RPC `move_opportunity` (otimista no cliente), tanto pelo `<select>` quanto pelo drop — fonte única e auditada.

## Dados (sem SQL novo)

Usa colunas que já existem em `opportunities`: `patient_id`, `title`, `stage`, `status` (`aberto`/`ganho`/`perdido`), `value`, `source`, `responsible_user_id`, `tags[]`, `lost_reason`.

- **Criar:** `insert` com `user_id = effectiveUserId` (RLS `with check user_id = data_owner_id()`), `status='aberto'`, `stage_entered_at=now`.
- **Editar:** `update` dos campos (título, valor, origem, responsável, tags). Estágio NÃO se edita aqui — só por move/drag (pra sempre passar pela RPC auditada).
- **Ganho/Perdido:** `update status`, `lost_reason` (só perdido). Sai do board (que filtra `status='aberto'`).
- **Responsável:** opções de `clinic_members` (`user_id`, `member_email`). "Sem responsável" é válido (null).

## UI

**Barra (acima do board):** busca por nome, selects Responsável / Origem / Tag (origens e tags derivadas das oportunidades carregadas), botão "+ Nova oportunidade". Filtros no cliente (dados já em memória) → instantâneo.

**Editor (Modal):** Paciente (`PatientSelector`), Título, Valor (FInput number, máscara BRL), Estágio (só na criação; no editar fica como leitura + dica "arraste pra mover"), Origem (FInput creatable), Responsável (select), Tags (input que adiciona chips). Rodapé: **Salvar** + **Ganho** / **Perdido** (perdido pede motivo).

**DnD nativo:** card `draggable`, `onDragStart` grava o id no `dataTransfer`; coluna com `onDragOver` (preventDefault + destaque) e `onDrop` → `moveOpp(id, stage)` se mudou de coluna. `<select>` mantido (acessível/celular).

## Mapa de propagação

- Criar/editar/ganho/perdido **não** tocam caixa, DRE, contas, metas, dashboard — oportunidade é pré-venda; o financeiro entra quando vira cirurgia/consulta (já ligadas por `opportunity_id`, nullable).
- Mover (inclusive por drag) usa a RPC existente → mesma propagação do move manual de hoje (grava `opportunity_stage_history`).
- Ganho/Perdido muda só `status`/`lost_reason`; some do board aberto. Nenhum total derivado muda.

## Checklist de fidedignidade

- [x] Estágio só muda pela RPC `move_opportunity` (auditado) — nunca por update solto.
- [x] Criar respeita RLS (`user_id = data_owner_id()`); paciente novo via `PatientSelector` (fluxo já existente).
- [x] Nenhum KPI/total financeiro é tocado.
- [x] Otimismo no cliente com rollback em erro (padrão já usado no move).

## Testes

- e2e `tests/e2e/pipeline-crud.spec.js`: abre "Nova oportunidade" (modal aparece), filtros aparecem, e o board renderiza (com bypass de auth). Mock de RPC/insert onde necessário, asserções de UI (padrão do `opportunity-pipeline.spec.js`).
- Build limpo + unit suite verde.

## Decisões confirmadas

- Arrastar: **HTML5 nativo**.
- **Ganho/Perdido incluído** no editor.
