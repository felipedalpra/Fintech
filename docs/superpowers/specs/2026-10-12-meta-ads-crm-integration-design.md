# Integração Meta Ads ↔ CRM (design / spec)

> CRM Fase 2+ (nova frente). Objetivo: ver em tempo real os anúncios/campanhas do Meta (Facebook/
> Instagram) da clínica, capturar os leads automaticamente no **pipeline de oportunidades**, e fechar o
> laço mostrando **quais campanhas geram cirurgia/receita de verdade** (CAC e ROAS por campanha),
> cruzando com o razão financeiro (trabalho do Codex). Spec primeiro; implementação depois.

## 1. A grande ideia (minha opinião do que vale a pena)
Um "dashboard de anúncios" sozinho é commodity. O que diferencia, numa clínica cirúrgica, é **fechar o
laço lead → pipeline → receita**:

1. **Lead em tempo real → funil:** quando alguém preenche um formulário de Lead Ad (ou chama no
   WhatsApp vindo de um anúncio), vira **oportunidade automaticamente** no estágio "Primeiro Contato",
   **etiquetada com a campanha/anúncio** de origem.
2. **Atribuição até o dinheiro:** como a oportunidade avança (consulta → orçamento → reserva paga →
   cirurgia), a clínica vê, **por campanha/anúncio**: nº de leads, custo por lead (CPL), quantos viraram
   consulta/reserva, **CAC real** (gasto ÷ pacientes fechados) e **ROAS** (receita do razão ÷ gasto).
   Isso responde a pergunta que importa: *"qual anúncio me traz paciente de cirurgia, não só clique?"*
3. **Laço de otimização (fase 2):** devolver ao Meta, via **Conversions API**, os eventos de qualidade
   (lead qualificado / reserva paga) para o algoritmo **otimizar por quem fecha**, não por volume de
   formulário. É o que CRMs maduros (Kommo/HubSpot) fazem.

Ou seja: Meta Ads deixa de ser uma aba isolada e vira **a boca do funil**, medida até a receita.

## 2. Como o Meta expõe isso (pesquisa)
- **Leads em tempo real = Webhooks `leadgen`.** O Meta manda uma notificação com `leadgen_id`,
  `page_id`, `form_id`, `ad_id` — **não** o lead completo. A app busca os dados com
  `GET /{leadgen_id}` (Graph API) usando **Page access token** + permissão `leads_retrieval`.
- **Confiabilidade:** webhook pode se perder → precisa de **backfill agendado** (re-ler leads recentes
  dos formulários) + **dedupe por `leadgen_id`**. O Meta guarda leads ~90 dias (puxar logo).
- **Métricas = Insights API.** `GET /{campaign|adset|ad|act_<id>}/insights` com `fields` =
  `impressions, clicks, spend, cpm, ctr, reach, actions` (o tipo `lead` em `actions` conta os leads).
  `spend` vem como string decimal em reais; janela ~37 meses; **não é real-time** (atraso de horas) —
  então "tempo real" prático = leads via webhook (instantâneo) + métricas sincronizadas algumas vezes/dia.
- **Auth:** Facebook Login → **Page access token** (leads) e token de Ads (insights). Escopos:
  `ads_read`, `leads_retrieval`, `pages_show_list`/`pages_manage_metadata`, `business_management`.
  Para servidor, o ideal é um **System User token** (longo, do Business Manager).
- **Laço de volta = Conversions API (CAPI) para leads.** Enviar mudanças de estágio como eventos
  offline: Qualificado → `Lead`, Reserva paga/Ganho → `Purchase` com valor. E-mail/telefone
  **hasheados SHA-256**. Janela de ~7 dias (maior p/ alguns offline).

### ⚠️ Realidade de ativação (ler antes de prometer prazo)
Para ler os anúncios/leads **reais** da clínica, o app precisa de **Acesso Avançado** às permissões
`ads_read` e `leads_retrieval`, o que exige **App Review + Verificação de Negócio + Tech Provider
verification** no Meta. Lead é dado pessoal → escrutínio extra. Isso é **processo de semanas**, não é
"ligar uma chave". Com Acesso Padrão só dá para testar com páginas/formulários de teste próprios.
**Plano:** começar com o app em modo dev/teste (página de teste da própria clínica) enquanto a
verificação tramita; a arquitetura fica pronta-pra-credencial (igual fizemos com Z-API).

## 3. Benchmarks
- **Kommo / RD Station / HubSpot:** Lead Ads via webhook → cria o lead/negócio no pipeline com a origem;
  dashboards de campanha; e o laço CAPI para otimização. Copiar: origem etiquetada no card + métricas
  por campanha + atribuição até o fechamento.
- Conectores genéricos (Zapier/partners) fazem só o webhook→CRM; o nosso diferencial é **a atribuição
  até a receita** (temos o razão) e o funil cirúrgico específico.

## 4. Arquitetura proposta (dentro das restrições do projeto)
**Restrição dura:** Vercel Hobby = **12/12 funções serverless** e 2 crons (no teto). Então:
- **1 endpoint consolidado `api/meta.js`** com `?action=oauth|webhook|sync` (padrão do `api/whatsapp.js`)
  — zero função nova além desta.
- **Sync de insights no cron que já existe** (`api/alerts/process.js`, diário) — como já fiz com as
  automações de WhatsApp e do funil. Sem cron novo.
- **Webhook de leadgen** = `api/meta.js?action=webhook` (verificação `hub.challenge` + validação de
  assinatura `X-Hub-Signature-256`), idempotente por `leadgen_id`.

**Fluxo:**
```
Facebook Login/OAuth → api/meta.js?action=oauth  → guarda token/ad_account/page (meta_connections)
Lead Ad submit       → webhook leadgen            → busca o lead → ensure_meta_lead() → oportunidade (origem=meta, campanha/anúncio) em "primeiro_contato"
Cron diário          → sync insights (campanhas)  → grava snapshots (meta_insights)
Pipeline avança      → (fase 2) CAPI envia evento de qualidade de volta ao Meta
UI (área CRM)        → "Anúncios": campanhas, gasto, leads, CPL, CAC, ROAS por campanha + origem no card
```

## 5. Modelo de dados (Supabase, RLS por `data_owner_id()`)
- **`meta_connections`** — por clínica: `ad_account_id`, `page_id`, `access_token`/`system_user_token`
  (SELECT revogado do frontend, lido só via service role, igual `whatsapp_numbers`), `webhook_secret`,
  `status`, escopos concedidos.
- **`meta_campaigns`** — espelho leve: `campaign_id`, `name`, `status`, `objective`, `daily_budget`.
- **`meta_insights`** — snapshot por dia × nível (campaign/adset/ad): `spend`, `impressions`, `clicks`,
  `leads`, `date`. (Derivado da Insights API; fonte de verdade é o Meta, isto é cache.)
- **`opportunities`** ganha: `meta_lead_id` (único, idempotência), `meta_campaign_id`, `meta_ad_id`,
  `utm_source/campaign/medium`, `source='meta'`. (Reusa o funil/automação que já existe.)
- **RPC `ensure_meta_lead(owner, lead payload)`** — cria paciente+oportunidade idempotente por
  `meta_lead_id` (espelha o `ensure_whatsapp_lead`).

## 6. Mapa de propagação (o que muda aqui afeta o quê)
| Toca | Afeta | Garantia |
|------|-------|----------|
| Lead do Meta | cria **oportunidade** no pipeline (mesma tabela do CRM) | reusa funil/automação; dedupe por `meta_lead_id` |
| `meta_insights` (gasto) | dashboard de anúncios, CAC/ROAS | é **cache** do Meta; nunca entra como despesa no razão sem o usuário mandar (evita dupla contagem com o financeiro do Codex) |
| Oportunidade → ganho/receita | ROAS por campanha | receita vem do **razão** (fonte única); atribuição por `meta_campaign_id` |
| Token do Meta | webhook/sync | lido só no servidor (service role), nunca no cliente |

## 7. Checklist de fidedignidade
1. **Lead idempotente:** `leadgen_id`/`meta_lead_id` único; webhook reenviado não duplica oportunidade.
2. **Backfill cobre webhook perdido** (re-leitura agendada dos formulários), sem duplicar.
3. **Gasto do Meta não vira despesa automática** no razão (evita dupla contagem com o financeiro) —
   a menos que o usuário escolha lançar; é informativo/atribuição por padrão.
4. **Receita/ROAS** derivada do razão (fonte única), por competência; atribuição por campanha é aditiva.
5. **Token nunca no frontend**; assinatura do webhook validada; multi-tenant por `data_owner_id()`.
6. **Fuso/datas:** insights por dia no fuso da conta; CAC/ROAS por janela coerente.

## 8. Plano faseado (uma branch por fase, spec→impl)
1. **Conexão + Lead em tempo real (MVP):** `meta_connections`, OAuth (`?action=oauth`), webhook leadgen
   (`?action=webhook`) + `ensure_meta_lead` → oportunidade etiquetada. Tela de conexão (admin). (Em modo
   teste até o App Review liberar.)
2. **Insights + dashboard de anúncios:** sync no cron, `meta_campaigns`/`meta_insights`, tela "Anúncios"
   (gasto, leads, CPL por campanha).
3. **Atribuição até a receita:** CAC/ROAS por campanha cruzando com o razão; origem no card do pipeline.
4. **Laço CAPI (otimização):** enviar eventos de qualidade (qualificado/reserva paga) de volta ao Meta.
5. **Backfill/robustez + App Review/verificação de negócio** (processo Meta, paralelo).

## 9. Riscos / decisões
- **App Review/Business Verification** é o maior risco de cronograma (semanas) — começar o processo cedo.
- **Vercel Hobby 12/12:** obriga o endpoint único + sync no cron existente (já previsto).
- **Privacidade/LGPD:** lead do Meta traz dado pessoal — mesmo tratamento dos pacientes (RLS, consentimento).
- **Não duplicar o financeiro:** gasto de anúncio é informativo; só vira despesa no razão se o usuário mandar.
- **Conector "claude.ai meta":** existe mas exige autorização OAuth (fora desta sessão) — não dá pra usar aqui agora; a integração é via app próprio no Meta for Developers.

## Fontes (pesquisa)
- [Meta — Webhooks for Lead Ads (CRM)](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/quickstart/webhooks-integration/)
- [Meta — Connecting your CRM with Lead Ads (Conversion Leads)](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/crm-integration/1-connecting-your-crm-with-lead-ads)
- [Meta — Marketing API authorization](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization)
- [Meta Ads Insights (campos spend/impressions/actions) — exemplo de tooling](https://glama.ai/mcp/servers/@pipeboard-co/meta-ads-mcp)
- [CAPI para leads / enviar estágio do CRM ao Meta (padrão de vendors)](https://www.datahash.com/connections/meta/capi-for-crm/)
- [App Review / Business Verification / Tech Provider (guia terceiro)](https://singhamandeep.com/?p=1383)
