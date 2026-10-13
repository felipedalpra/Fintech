# Meta Ads · Fase 2 — Dashboard de Desempenho + Análises por IA

> Continuação da spec `docs/superpowers/specs/2026-10-12-meta-ads-crm-integration-design.md`.
> A Fase 1 (lead em tempo real → funil) já está na `main`. Spec primeiro; implementação depois da
> aprovação do mockup. Segue o padrão da seção 7 da spec de arquitetura.
>
> **Decisão de escopo (Felipe, 12/10/2026):** a tela é um **espelho fiel do Meta Ads** — só puxa o
> que vem de lá, **não cruza com o financeiro** (sem CAC/ROAS por receita, sem lançar gasto no razão).
> A aba **Análises** faz a **interpretação por IA** dos números do Meta. Mockup aprovado:
> estilo dark, sub-abas Desempenho/Análises, drill Campanhas→Conjuntos→Anúncios.

## 1. Goal
Ver, em um só lugar, **como os anúncios do Meta estão performando** — gasto, alcance, impressões,
cliques, CTR, leads e CPL — por **campanha, conjunto e anúncio**, para identificar o que está indo
melhor. E uma aba **Análises** onde a IA lê esses números e aponta o que escalar, pausar ou trocar.

## 2. Contexto do cliente
Dra. Vitória/Augusto investem em tráfego e hoje dependem do Gerenciador de Anúncios do Meta pra
entender retorno. Felipe quer isso **dentro do SurgiMetrics**, fiel ao Meta, sem inventar número nem
misturar com o financeiro. "Interpretação" por IA foi pedida explicitamente. Ver `project_phase1_funnel_oct2026`.

## 3. Área e lugar na navegação
Área **CRM / Comercial**. Nova aba **"Anúncios"** (ao lado de Pipeline e WhatsApp), com duas sub-abas:
- **Desempenho** — tabela/KPIs com drill Campanhas → Conjuntos → Anúncios.
- **Análises** — leitura em IA das campanhas.

A tela de **conexão** continua em Configurações → Meta Ads (admin), já existente.

## 4. Benchmark e o que copiar
- **Gerenciador de Anúncios do Meta / Kommo / RD:** tabela por nível (campanha/conjunto/anúncio) com
  as métricas nativas, ordenável, com drill. **Copiar** a hierarquia e o conjunto de métricas.
- **Diferencial:** a aba de **Análises por IA** — em vez de só a tabela, uma leitura em linguagem
  natural ("escale a X, o criativo da Y desgastou — frequência 4,7"). Reusa a IA que o app já tem.

## 5. Fluxo ideal
1. Admin/Gestão abre **CRM → Anúncios → Desempenho**, escolhe o período (pills) e o nível
   (Campanhas / Conjuntos / Anúncios).
2. Vê a **faixa de KPIs** (Gasto · Alcance · Impressões · Cliques/CTR · Leads · CPL) e a **tabela**
   do nível escolhido, ordenável por qualquer coluna, com selo "★ melhor CPL".
3. Clica numa campanha → desce pros **conjuntos** dela; clica num conjunto → desce pros **anúncios**.
4. Selo de **frescura do sync** ("sincronizado há 2h") — insights do Meta não são real-time.
5. Abre **Análises** → a IA mostra recomendações sobre as campanhas do período (escalar/pausar/
   trocar criativo, CPL subindo, melhor CTR). Botão "Reanalisar" regenera.

## 6. Modelo de dados e propagação

### 6.1 Tabelas (cache do Meta — fonte de verdade é o Meta)
- **`meta_campaigns`** / **`meta_adsets`** / **`meta_ads`** — espelho leve de cada nível:
  `user_id`, `*_id` (único por owner), `name`, `status`, parent id (`campaign_id` no adset,
  `adset_id`/`campaign_id` no ad), `effective_status`, `updated_at`.
- **`meta_insights`** — snapshot diário × nível: `user_id`, `level` ('campaign'|'adset'|'ad'),
  `ref_id`, `campaign_id`, `date`, `spend`, `impressions`, `reach`, `clicks`, `leads`. Métricas
  derivadas (CTR, CPC, CPM, frequência, CPL) são **calculadas na leitura**, não armazenadas.
  Único por `(user_id, level, ref_id, date)`.
- **`meta_analyses`** (cache da leitura por IA) — `user_id`, `period`, `generated_at`, `model`,
  `payload` (texto/estrutura das recomendações). Opcional; evita recomputar a cada abertura.
- `opportunities.meta_campaign_id` (já existe, Fase 1) segue marcando a origem do lead no pipeline —
  **não** é usado aqui pra receita.

### 6.2 Sync (sem função serverless nova — teto 12/12 do Vercel Hobby)
- Motor novo em `api/_lib/metaInsights.js` → `syncMetaInsights(supabase,{owner,since})`.
  Chamado pelo **cron de alertas existente** (`api/alerts/process.js`, diário) e por
  `api/whatsapp.js?action=meta-sync` (manual/QA, autorizado por `CRON_SECRET`).
- Lê `GET /act_<id>/insights?level=campaign|adset|ad&fields=spend,impressions,reach,clicks,actions`
  + os endpoints de estrutura (`/campaigns`, `/adsets`, `/ads`) e faz **upsert idempotente**.

### 6.3 Análises por IA
- Gerada sob demanda reusando a infra OpenAI que já existe em `api/financial-assistant.js`
  (nova `action`/`mode` — **sem endpoint novo**). Entrada = os insights agregados do período
  (campanha/conjunto/anúncio); saída = recomendações em texto estruturado; cache em `meta_analyses`.
- A IA **só interpreta os números do Meta** — não acessa financeiro nem inventa dados.

### 6.4 Mapa de propagação
| Toca | Afeta | Garantia |
|------|-------|----------|
| `meta_insights` (sync) | KPIs, tabela, Análises | **cache** fiel do Meta; upsert idempotente por chave natural; **não** entra no caixa/DRE/razão |
| métricas derivadas (CTR/CPC/CPM/CPL) | tabela/KPIs | calculadas na leitura a partir do cache; nunca armazenadas (não divergem) |
| Análises por IA | aba Análises | lê só os insights; cache opcional; rótulo de "gerado por IA · data" |
| financeiro / razão | — | **intocado**; esta frente não lê nem escreve financeiro |

## 7. Pontos de integração/automação
- **Cron de alertas** (existente) carrega o sync — sem cron novo (2/2 no teto).
- **IA** reusa `api/financial-assistant.js` (OpenAI) — sem função nova.
- **App Review / `ads_read`** do Meta é pré-requisito pra ler insights reais; até lá, conta de teste
  + aviso "modo teste" (igual Z-API). CAPI/atribuição à receita ficam fora (não desejado agora).

## 8. Permissões
- **Anúncios (ver):** Admin ✅ · Gestão ✅ · Equipe ❌.
- **Conexão Meta (Configurações):** Admin ✅ apenas (já implementado).
- Enforcement via `UserRoleContext` + RLS por `data_owner_id()`.

## 9. Mapa de arquivos
**Criar:**
- `supabase/meta_insights_schema.sql` — `meta_campaigns`/`meta_adsets`/`meta_ads`/`meta_insights`/
  `meta_analyses`, índices, RLS, grants.
- `api/_lib/metaInsights.js` — `parseInsightsResponse` (puro) + `syncMetaInsights` + derivação de
  métricas (CTR/CPC/CPM/CPL) pura e testável.
- `src/components/MetaAdsDashboard.jsx` — tela "Anúncios": sub-abas, drill, KPIs, tabela, período.
- `src/components/MetaAdsAnalysis.jsx` — aba Análises (recomendações por IA + "Reanalisar").
- `tests/unit/metaInsights.spec.js` — parsing + derivação de métricas + idempotência.

**Editar:**
- `api/alerts/process.js` — chamar `syncMetaInsights` no cron diário.
- `api/whatsapp.js` — `?action=meta-sync` (gatilho manual).
- `api/financial-assistant.js` — modo "análise de anúncios" (reusa OpenAI).
- navegação do CRM → montar `MetaAdsDashboard` com guarda de permissão.
- `CHANGELOG.md` (obrigatório).

## 10. Tasks (numeradas)
1. SQL `meta_insights_schema.sql` (cache + RLS + grants) — rodar no Supabase.
2. `metaInsights.js`: parsing + derivação + `syncMetaInsights` (fetch estrutura + insights, upsert).
3. Ligar sync no cron existente + `?action=meta-sync` manual.
4. `MetaAdsDashboard.jsx`: período, KPIs, drill Campanhas/Conjuntos/Anúncios, tabela ordenável,
   selo de frescura; dark-mode com constantes **dentro** do componente.
5. Modo de análise por IA em `financial-assistant.js` + `MetaAdsAnalysis.jsx` + cache `meta_analyses`.
6. Navegação CRM → "Anúncios" com guarda Admin/Gestão.
7. Testes unitários (parsing/derivação/idempotência).
8. `CHANGELOG.md` (Added).

## 11. Checklist de fidedignidade
1. **Espelho fiel:** os números batem com o Gerenciador do Meta; nada inventado.
2. **Insights são cache:** re-sync (upsert) não duplica; chave natural `(owner,level,ref_id,date)`.
3. **Métricas derivadas na leitura** (CTR/CPC/CPM/CPL) — nenhum total salvo em paralelo.
4. **Não toca o financeiro:** gasto não vira despesa; nenhuma leitura/escrita no razão/caixa/DRE.
5. **Fuso/datas:** insights por dia no fuso da conta; período coerente entre KPIs, tabela e análise.
6. **Multi-tenant:** RLS por `data_owner_id()`; token lido só no servidor (service role).
7. **IA rotulada:** a análise aparece como "gerada por IA · data", sem se passar por dado oficial.

## 12. Testes e aceitação
- `npm run test:unit`: parsing de insights (campaign/adset/ad); derivação de CTR/CPC/CPM/CPL;
  idempotência do upsert.
- Aceitação manual: período muda os números; drill desce de campanha → conjunto → anúncio; ordenação
  por coluna; selo de frescura; Análises gera recomendações coerentes com os números; Equipe não acessa.
- `CHANGELOG.md` atualizado no mesmo commit.

## Fora de escopo (por decisão)
- CAC/ROAS cruzando com a receita do razão; lançar gasto de anúncio no financeiro.
- Laço CAPI (devolver eventos ao Meta) — fica pra uma fase futura, se desejado.
- Recortes nativos do Meta (posicionamento/idade/região) na aba Análises — a escolha foi
  interpretação por IA; breakdowns podem entrar depois se fizer falta.
