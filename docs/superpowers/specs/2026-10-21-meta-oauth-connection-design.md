# Conexão Meta Ads via OAuth ("Continuar com Facebook")

Data: 2026-10-21
Status: aprovada, aguardando plano de implementação
Spec anterior relacionada: `docs/superpowers/specs/2026-10-12-meta-ads-crm-integration-design.md` (pesquisa ampla da integração Meta Ads↔CRM). Esta spec é mais estreita: só o passo de **conexão** (Fase 1 daquela spec), substituindo a entrada manual de token por um login OAuth self-serve.

## Objetivo

Eliminar o processo manual e não escalável de conectar uma clínica ao Meta Ads (hoje: admin cola Ad Account ID, Page ID e um Access Token gerado manualmente no Graph API Explorer, o que exige dar acesso de admin no Business Manager pra cada clínica nova). No lugar, a clínica clica em **"Continuar com Facebook"** em Configurações → Meta Ads, loga, autoriza, e a conexão fica pronta — sem ninguém colar token, sem precisar virar admin do Business Manager de cada cliente.

## Contexto do cliente

Achado durante a ativação manual da Dra. Vitória (21/10/2026): pro processo funcionar, o Felipe precisaria logar com a conta dela no Graph API Explorer pra gerar o token — e isso se repetiria a cada clínica nova. O próprio Felipe identificou que não é sustentável e pediu pra parar e construir o fluxo certo antes de conectar qualquer clínica de verdade.

## Decisões já tomadas com o usuário

| Tema | Decisão |
|---|---|
| Campos manuais (Ad Account ID / Page ID / token colado) | **Substituídos totalmente** pelo botão OAuth — não fica como fallback |
| Mais de uma Página/Conta de Anúncio disponível | Mostra **seletor** — não assume a primeira nem trava com erro |
| Quem inicia a conexão | Só admin da clínica (mesmo gate que já existe na aba Meta Ads do Settings) |
| App do Meta | **Um único app, da Zentri Tech**, reutilizado por todas as clínicas clientes — nunca um app por cliente |

## Fora de escopo (fica pra depois)

- Laço de volta via Conversions API (otimização) — já listado como fase 4 na spec de 12/10.
- Dashboard de campanhas/insights (fase 2 da spec de 12/10) — essa spec só cobre a conexão.
- System User token (Business Manager) sem expiração — rejeitado porque reintroduz o processo manual que estamos eliminando; aceitamos a reconexão periódica em troca de ser self-serve (ver "Expiração" abaixo).

## Arquitetura

```
MetaConnection.jsx ──► api/whatsapp.js?action=meta-connect   ──► redireciona pro diálogo OAuth do Meta
                                                                   (produto "Login do Facebook para empresas",
                                                                    parâmetro config_id)
                   ◄── api/whatsapp.js?action=meta-callback  ◄── Meta redireciona de volta com `code`
                        │
                        └─► api/_lib/metaOAuth.js: troca code → token curto → token longo (~60d)
                             → busca TODAS as Páginas/Contas de Anúncio que a pessoa concedeu acesso
                             → se só 1 de cada: salva direto (conectado)
                             → se mais de 1: salva como status:'selecionando' (token guardado,
                               page_id/ad_account_id ainda null) e devolve a lista pro front

MetaConnection.jsx ──► api/whatsapp.js?action=meta-select    ──► (só quando status:'selecionando')
                        admin escolhe 1 Página + 1 Conta de Anúncio na tela do próprio SurgiMetrics
                        → grava page_id/ad_account_id → status:'conectado'

MetaConnection.jsx ──► api/whatsapp.js?action=meta-disconnect ──► revoga no Meta (best-effort) + apaga local
```

`status` de `meta_connections` ganha o valor `selecionando` (além de `desconectado`/`configurado`/`conectado`/`erro`/`expirando`), usado só no intervalo entre o callback (token já salvo) e a confirmação da Página/Conta na tela própria.

### Por que dentro de `api/whatsapp.js` e não um `api/meta.js` novo

A spec de 12/10 (seção 4) havia planejado um `api/meta.js` próprio. A implementação real divergiu: o webhook e o sync do Meta já foram implementados dentro de `api/whatsapp.js` (`?action=meta-webhook`, `?action=meta-sync`), com o comentário no topo de `api/_lib/meta.js` explicando o motivo — limite de 12 funções serverless da Vercel. Esta spec segue a convenção já estabelecida no código (não a spec antiga): as novas rotas de OAuth entram no mesmo `api/whatsapp.js`, como `?action=meta-connect`, `?action=meta-callback` e `?action=meta-disconnect`.

### `api/_lib/metaOAuth.js` (novo, funções puras testáveis)

Espelha `api/_lib/googleCalendarApi.js` (padrão já implementado e testado nesta base pro Google Agenda):

| Função | Faz |
|---|---|
| `buildAuthUrl(config, state)` | Monta a URL do diálogo "Login do Facebook para empresas" (`config_id`, `redirect_uri`, `state`) |
| `signState(secret, payload)` / `verifyState(secret, raw)` | CSRF: assina/valida a `state` (HMAC, mesmo padrão do Google) |
| `exchangeCode(config, code)` | Troca `code` → User Access Token curto |
| `exchangeLongLivedToken(config, shortToken)` | Troca → User Access Token longo (~60 dias) |
| `fetchGrantedPages(longToken)` | Lista Páginas que a pessoa autorizou, com Page Access Token de cada uma |
| `fetchGrantedAdAccounts(longToken)` | Lista Contas de Anúncio autorizadas |
| `revokeToken(token)` | `DELETE /me/permissions` best-effort, igual ao `revokeToken` do Google |

## Modelo de dados — `meta_connections` (ajustes aditivos)

| Coluna | Mudança |
|---|---|
| `access_token` | **Substituída** por `access_token_encrypted` (jsonb, formato `encryptPayload`) — nunca mais texto puro |
| `token_expires_at` | Nova — usada pro aviso de reconexão |
| `connected_by` | Nova — `uuid` de quem autorizou (auditoria) |
| `fb_user_id` | Nova — identifica a conta autorizadora (suporte) |
| Grants | `access_token_encrypted`/`token_expires_at`/`fb_user_id` saem do alcance de `authenticated` (INSERT/UPDATE) — só `service_role` escreve. O frontend nunca mais manda nem lê token, nem write-only |

Linhas antigas com `access_token` em texto puro (se alguma clínica já tiver passado pela configuração manual) são migradas para `status:'erro'` pedindo reconexão — nunca ficam com token sem criptografia nem em formato ambíguo.

Durante `status:'selecionando'`, o que fica salvo é o **User Access Token de longa duração** (criptografado) — o Page Access Token definitivo só é gerado em `?action=meta-select`, depois que a Página é escolhida (um Page Access Token é derivado da Página específica, não existe "genérico" antes da escolha).

## Variáveis de ambiente novas (Vercel)

- `META_CLIENT_CONFIG_ID` — o `config_id` da configuração "Login do Facebook para empresas" criada no app.
- `META_OAUTH_REDIRECT_URI` — `https://www.surgimetrics.com.br/api/whatsapp?action=meta-callback`.
- Reaproveita `META_APP_SECRET` e `META_GRAPH_VERSION`, já cadastradas.

## Expiração e reconexão

Tokens do Meta (mesmo de longa duração) expiram em ~60 dias — não existe refresh token eterno no login padrão. Em vez de falhar silenciosamente:

- Cron diário existente (o mesmo que já roda alertas/automações de WhatsApp) verifica `token_expires_at` perto do vencimento e marca `status:'expirando'`.
- A tela mostra aviso com botão "Reconectar" (mesmo fluxo OAuth do zero, token novo substitui o antigo).
- Token já vencido → `status:'erro'`, nunca tenta usar um token morto pra ler leads.

## Erros tratados explicitamente

| Caso | Comportamento |
|---|---|
| `state` inválida/expirada (CSRF) | Erro explícito, nunca prossegue com o callback |
| Usuário cancela o login no Meta | Volta pra tela com mensagem neutra, status não muda |
| Conta autorizada não é admin de nenhuma Página elegível | Erro explicando que precisa logar com uma conta admin da Página |
| Token sem `leads_retrieval`/`ads_read` (app ainda em modo dev fora da lista de testadores) | Erro específico — nunca finge "conectado" sem as permissões |
| Mais de uma Página/Conta autorizada | `status:'selecionando'`; tela própria lista as opções e confirma com `?action=meta-select` |

## Mapa de propagação

| Toca | Afeta | Garantia |
|---|---|---|
| `meta_connections` (novo token/página/conta) | Webhook `?action=meta-webhook`, sync `?action=meta-sync` (já existentes) | Passam a ler token criptografado via `service_role`; nenhuma mudança no formato de evento recebido |
| Status da conexão | Tela Configurações → Meta Ads | Badge reflete `conectado`/`expirando`/`erro`/`desconectado` em tempo real |
| Desconexão | Webhook/sync param de processar leads dessa clínica | Leads que já viraram oportunidade **não são revertidos**; só novos leads param de entrar |

## Checklist de fidedignidade

1. Token nunca trafega nem fica legível no frontend (nem write-only como hoje) — só `service_role`.
2. Nenhum lead é processado com token vencido (checagem de `token_expires_at` antes de cada uso no webhook/sync).
3. Desconectar revoga no Meta (best-effort) e limpa local — nunca deixa token órfão ativo do lado do Meta.
4. `state` sempre validada antes de qualquer troca de código (CSRF fechado).
5. RLS/escopo por `data_owner_id()` mantido — sem mudança de modelo multi-tenant.
6. Migração de `access_token` texto puro → criptografado não perde `ad_account_id`/`page_id` já configurados; linha inconsistente vira `status:'erro'` explícito, nunca dado incerto silencioso.

## Permissões

Só admin da clínica (mesmo `role === 'admin'` que já controla a visibilidade da aba Meta Ads no `Settings.jsx`) pode iniciar/desconectar. Leitura do status (`conectado`/`erro`/etc., sem o token) segue disponível só pra admin, igual hoje.

## Testes

- **Unitários** (`tests/unit/metaOAuth.spec.js`, novo): `buildAuthUrl` monta URL certa com `config_id`; `signState`/`verifyState` aceita válido e rejeita adulterado/expirado; `exchangeCode`/`exchangeLongLivedToken`/`fetchGrantedPages`/`fetchGrantedAdAccounts` com `fetch` mockado (sucesso e erro); cálculo de `token_expires_at`.
- **E2E** (`tests/e2e/meta-connection.spec.js`, novo): botão "Continuar com Facebook" quando desconectado; callback com 1 Página/1 Conta conecta direto; callback com múltiplas mostra a tela de seleção própria e `meta-select` conclui a conexão; aviso de expiração aparece perto do vencimento; desconectar limpa a tela — mockando as chamadas à Graph API (mesmo padrão dos outros testes de integração externa do projeto).
- `CHANGELOG.md` obrigatório no mesmo commit (categoria `Added`), citando a migration SQL e os arquivos tocados.

## Riscos / decisões em aberto

- **App Review ainda pendente** pro app novo da Zentri Tech (criado em 21/10/2026, dentro do Business Manager já verificado) — enquanto não aprova `leads_retrieval`/`ads_read`, o fluxo só funciona em modo desenvolvimento (contas/Páginas adicionadas como testadoras no app). A conexão da Dra. Vitória, especificamente, só vira "produção de verdade" depois da aprovação.
- **Webhook de leadgen já estava configurado manualmente** nesse app novo (passo anterior desta sessão) — a Fase de conexão OAuth não muda isso, só substitui como o `access_token`/`page_id` chegam no banco.
