# Spec — IA sugere avanço de estágio por mensagem (CRM, Fase 2 · sub-projeto 4)

**Data:** 2026-10-11
**Pediu:** Felipe (visão da Dra. Vitória — "ir passando dos estágios conforme as mensagens vão indo, interpretação automática, que nem o Kommo").
**Decisão de produto:** **sugere e confirma** — a IA nunca move o funil sozinha; ela propõe e um humano confirma com um clique.

## Problema

Hoje o estágio da oportunidade só muda quando alguém arrasta/seleciona manualmente. O lead novo entra em `primeiro_contato` (sub-projeto autocreate) e fica lá mesmo que a conversa no WhatsApp já indique "quero marcar consulta", "quanto custa", "fechado, vou fazer". O atendente precisa lembrar de mover à mão.

## Objetivo

Conforme chegam mensagens, a IA lê a conversa recente e **sugere** o estágio mais provável. A sugestão aparece como um aviso no card do pipeline e na conversa do inbox. O humano confirma (✓ move, via `move_opportunity`, auditado) ou descarta (✗). Zero movimentação autônoma.

## Não-objetivos (YAGNI)

- IA mover o funil sozinha (decisão explícita: não).
- Retroceder estágio por IA (só sugere avançar).
- Treinar/fine-tune modelo. Usa classificação zero-shot com prompt curto.
- Nova função serverless (estamos em 12/12 no Hobby) — roda dentro do webhook existente.

## Fluxo

```
Mensagem inbound chega  →  api/whatsapp.js (?action=webhook)
  1. grava a mensagem (já existe)
  2. resolve a oportunidade ABERTA do paciente (status='aberto')
  3. pré-filtro grátis (regex/palavras-chave) sobre as mensagens recentes
       sem sinal de avanço  → PARA (não gasta IA)
  4. rate-limit: já há sugestão 'pending' recente (< AI_SUGGEST_COOLDOWN_MIN)? → PARA
  5. IA classifica (OpenAI /v1/responses, modelo barato)
       input = últimas ~12 msgs + estágio atual + definição dos estágios
       output JSON = { stage, confidence, reason }
  6. valida: stage permitido, só avanço, confidence >= AI_SUGGEST_MIN_CONFIDENCE
       ok  → grava suggested_* + suggestion_status='pending' na oportunidade
  (tudo em try/catch; o webhook SEMPRE retorna 200 — IA nunca derruba o recebimento)
```

Confirmar/descartar é feito no cliente (sem função nova):
- **✓ Mover:** `rpc('move_opportunity', { opp_id, new_stage: suggested_stage, move_source: 'manual' })` → depois `update` zera a sugestão com `suggestion_status='confirmed'`.
- **✗ Ignorar:** `update suggestion_status='dismissed'`, limpa `suggested_stage`. Não re-sugere o mesmo (cooldown + status).

## Arquitetura (isolamento)

| Unidade | Arquivo | Responsabilidade | I/O? |
|---|---|---|---|
| Lógica pura de sugestão | `api/_lib/stageSuggest.js` | pré-filtro, decidir se roda IA, montar input, validar resposta (forward-only, limiar) | não (testável) |
| Cliente OpenAI | `api/_lib/stageSuggestClient.js` | chamar `/v1/responses` com deadline, extrair texto | sim |
| Orquestração | `api/whatsapp.js` (webhook) | ligar os passos 2–6 com service role | sim |
| Ações confirm/dismiss | `src/lib/opportunitySuggestion.js` | `confirmSuggestion` / `dismissSuggestion` compartilhados | sim (supabase) |
| UI pipeline | `src/components/OpportunityPipeline.jsx` | box de sugestão no card | — |
| UI inbox | `src/components/WhatsAppInbox.jsx` | banner de sugestão na conversa | — |

`stageSuggest.js` é a peça de fidedignidade: sem ela a IA nunca escreve no funil, e ela garante forward-only + limiar antes de qualquer `pending`.

## Dados (SQL — `supabase/whatsapp_ai_suggest.sql`)

Colunas novas em `opportunities` (a sugestão vive na própria oportunidade):

```
suggested_stage       text
suggested_reason      text
suggested_confidence  numeric(4,3)
suggested_at          timestamptz
suggestion_status     text not null default 'none'
                       check in ('none','pending','confirmed','dismissed')
```

RLS: a policy "for all clinic access" já existente cobre confirm (RPC) e dismiss (update do cliente). O webhook usa service role → ignora RLS. Índice parcial para `suggestion_status='pending'`.

## Estágios e sinais (fonte no backend)

Ordem forward-only: `primeiro_contato < consulta_agendada < consultado < orcamento_enviado < reserva_paga < follow_up`.

Pré-filtro (palavras-chave, PT-BR, sem custo) por estágio-alvo, ex.:
- consulta_agendada: "marcar", "agendar", "que dia", "horário", "consulta"
- orcamento_enviado: "quanto custa", "valor", "preço", "orçamento"
- reserva_paga: "paguei", "fiz o pix", "fechado", "pode reservar", "sinal"
- follow_up: "depois eu vejo", "mais pra frente", "vou pensar"

O pré-filtro só decide **se vale chamar a IA**; a classificação final é da IA (o keyword é dica, não veredito).

## Controle de custo

- Pré-filtro corta a maioria das mensagens (sem sinal → não chama IA).
- Modelo barato: `OPENAI_SUGGEST_MODEL` (default classe mini), prompt curto, `max_output_tokens` ~120.
- Cooldown por oportunidade (`AI_SUGGEST_COOLDOWN_MIN`, default 10): no máx. 1 análise por conversa por janela.
- Deadline curto (~6s); falha/timeout = sem sugestão, nunca quebra o webhook.

## Guardrails / fidedignidade

- IA só grava `pending`; **nunca** chama `move_opportunity`. Só o humano move.
- Forward-only: sugestão que não avança é descartada.
- Limiar de confiança (`AI_SUGGEST_MIN_CONFIDENCE`, default 0.70) antes de virar `pending`.
- Toda movimentação confirmada entra no `opportunity_stage_history` (source `manual`, `moved_by` = quem confirmou) — auditável.
- O texto do paciente é tratado só como dado, nunca como instrução (prompt hardening, igual ao assistente financeiro).

## Mapa de propagação

Escrever sugestão **não** altera estágio, totais, DRE, caixa, agenda — só as colunas `suggested_*`. A mudança real de estágio só acontece no confirm, que passa pelo `move_opportunity` já existente (mesma propagação do move manual). Logo, nenhum número derivado muda sem ação humana.

## Checklist de fidedignidade

- [x] Fonte única do estágio continua `opportunities.stage` (sugestão é campo à parte).
- [x] Nenhum total/KPI derivado é tocado pela IA.
- [x] Movimentação confirmada é atômica e auditada (RPC existente).
- [x] Webhook idempotente e à prova de falha de IA (try/catch, sempre 200).
- [x] Forward-only + limiar impedem sugestão ruim de virar ação.

## Testes

- `tests/unit/stageSuggest.spec.js`: pré-filtro, forward-only, parse válido/ inválido/ malformado, limiar, backward rejeitado.
- Build limpo + unit suite verde.
- e2e do pipeline continua passando (card com sugestão não quebra o fluxo existente).

## Decisões confirmadas

- Rodar IA: **pré-filtro + IA só com sinal** (padrão).
- Limiar de confiança para exibir: **0.70** (ajustável por env).
