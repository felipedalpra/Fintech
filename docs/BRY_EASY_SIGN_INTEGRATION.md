# BRy Easy Sign — referência para a integração clínica

## Estado deste documento

- Informações comerciais recebidas em **28/10/2026** para a integração da SurgiMetrics com a API BRy Easy Sign no modelo Self-Service.
- Referência técnica conferida na documentação pública da BRy na mesma data.
- **28/10/2026 — integração implementada atrás de feature flag, desligada por padrão** (branch `feat/bry-easy-sign-clinical`). A migration `supabase/clinical_signature_bry_schema.sql` foi aplicada em produção nessa data.
- **29/10/2026 — respostas da BRy recebidas e incorporadas.** O bloqueio de evidências foi resolvido: a evidência do certificado vem de um **segundo serviço** da BRy, de verificação de assinatura, que responde em JSON. O estado `signed` passou a ser alcançável. Foram corrigidos a caixa de `base64Document` e o fluxo de criação, que agora nasce como rascunho. Ver [Evidência do certificado](#evidência-do-certificado-como-o-signed-é-alcançado).
- **Nenhuma chamada real foi feita à BRy, nenhuma credencial foi recebida ou armazenada e nenhum crédito foi comprado.** A integração segue desligada por `BRY_EASY_SIGN_ENABLED=false`.
- Condições comerciais e comportamento da API devem ser reconfirmados com a BRy antes da ativação, pois podem mudar.

## Acessos oficiais

1. [BRy Cloud — cadastro, aplicações, chave/token e créditos](https://cloud.bry.com.br/home/usuarios/autenticado/pessoal/aplicacoes)
2. [Quickstart da API Easy Sign](https://bry-developer.readme.io/reference/quickstart-easy)
3. [Índice técnico da BRy para agentes e integrações](https://bry-developer.readme.io/llms.txt)
4. [Base de conhecimento da BRy](https://atendimento.bry.com.br/kb)
5. [Guia de assinatura médica](https://bry-developer.readme.io/reference/assinatura-m%C3%A9dica)

## Condições comerciais informadas pela BRy

Estas informações vieram do contato comercial/técnico, não do contrato nem da documentação pública:

- modelo Self-Service, sem contratação mensal mínima;
- consumo por créditos pré-pagos;
- recarga mínima de **R$ 35,00**;
- **R$ 10,00** em créditos iniciais após o cadastro;
- créditos adquiridos com validade de **1 ano**;
- integração, configuração e testes sob responsabilidade da equipe da SurgiMetrics, sem acompanhamento direto da BRy durante o desenvolvimento;
- acesso diretamente ao ambiente de produção;
- operações de teste consomem créditos.

Antes de comprar créditos, confirmar valores, validade, impostos, política de estorno e custo unitário de cada operação usada no fluxo.

## Resumo técnico verificado

### Autenticação e ambientes

- A Easy Sign usa um token JWT no cabeçalho `Authorization: Bearer <token>`.
- **Esse JWT é de vida curta.** A documentação de autenticação diz que o
  `access_token` “tem validade de alguns minutos” e que a aplicação deve
  renová-lo automaticamente. Ele é obtido por
  `POST {cloud}/token-service/jwt`, `application/x-www-form-urlencoded`, com
  `grant_type=client_credentials`, `client_id` e `client_secret`; a resposta traz
  `access_token`, `expires_in`, `refresh_token`, `refresh_expires_in` e
  `token_type`. Hosts: `https://cloud.bry.com.br` e `https://cloud-hom.bry.com.br`.
  O `client_secret` **não expira** e é segredo de servidor.
- A documentação de criação de envelope lista `https://easysign.bry.com.br` para produção e `https://easysign.hom.bry.com.br` para homologação.
- A documentação de obtenção de credenciais por e-mail informa que esse recurso é exclusivo do Quickstart em homologação e direciona contas oficiais para o BRy Cloud.
- A orientação recebida da BRy diz que o Self-Service começa em produção e que os testes consomem créditos. Portanto, **não presumir que a SurgiMetrics terá sandbox gratuito**; essa disponibilidade precisa ser confirmada.

O token é segredo de servidor. No futuro, deve ficar somente em variável protegida/cofre e nunca no navegador, Supabase, repositório, telemetria ou logs.

### Fluxo principal da API

1. A SurgiMetrics gera o PDF clínico sob sua responsabilidade.
2. O backend cria um envelope com `POST /api/service/sign/v1/signatures`.
3. O documento pode ser enviado em Base64 ou por URL acessível pela BRy.
4. A resposta traz o UUID do envelope, identificadores dos documentos e um link individual para cada signatário.
5. O link pode ser retornado para a aplicação ou enviado por e-mail/WhatsApp, conforme `typeMessaging` (`LINK`, `EMAIL`, `WHATSAPP`).
6. O profissional abre a página pronta da BRy e conclui a assinatura.
7. A SurgiMetrics acompanha o processo por consulta de status e/ou webhook.
8. Quando finalizado, o backend baixa o PDF assinado e o persiste no armazenamento clínico privado.

Estados de envelope documentados: `DRAFT`, `CREATED`, `ONGOING`, `FINISHED`, `EXPIRED` e `DELETED`.

### Modalidades de assinatura

A API documenta três modos em `signatureConfig.mode`:

- `SIMPLE`: assinatura eletrônica com coleta de evidências;
- `ADVANCED`: assinatura eletrônica com coleta de evidências e certificado digital;
- `QUALIFIED`: assinatura eletrônica com coleta de evidências e certificado digital ICP-Brasil.

Para `ADVANCED` e `QUALIFIED`, a API aceita algoritmo de hash e perfil de assinatura, incluindo perfis com carimbo do tempo.

O requisito atual da SurgiMetrics é não declarar assinatura ICP-Brasil sem evidência qualificada. Há uma inconsistência que precisa ser esclarecida com a BRy: o guia médico fala em certificado ICP-Brasil/assinatura qualificada, mas seu exemplo usa `mode: "ADVANCED"` com `profile: "TIMESTAMP"`. A implementação não deve escolher um modo até a BRy confirmar o payload correto para cada documento clínico.

### Metadados médicos descritos pela BRy

O guia médico orienta adicionar OIDs ao documento:

| OID | Tipo de documento |
| --- | --- |
| `2.16.76.1.12.1.1` | Prescrição de medicamento |
| `2.16.76.1.12.1.2` | Atestado médico |
| `2.16.76.1.12.1.3` | Solicitação de exame |
| `2.16.76.1.12.1.4` | Laudo laboratorial |
| `2.16.76.1.12.1.5` | Sumária de alta |
| `2.16.76.1.12.1.6` | Registro de atendimento clínico |
| `2.16.76.1.12.1.7` | Dispensação de medicamentos |
| `2.16.76.1.12.1.8` | Vacinação |
| `2.16.76.1.12.1.11` | Relatório médico |

Para profissional regido pelo CFM, o guia lista:

| OID | Informação |
| --- | --- |
| `2.16.76.1.4.2.2.1` | Número do registro profissional |
| `2.16.76.1.4.2.2.2` | UF do registro profissional |
| `2.16.76.1.4.2.2.3` | Especialidade |

Esses valores devem vir do perfil seguro e do snapshot imutável do documento. Nunca devem ser aceitos diretamente do navegador no momento de iniciar a assinatura.

### Webhooks, consulta e download

- A API permite cadastrar webhooks `easy.collection` para alterações do envelope e `easy.signature` para alterações de assinaturas.
- A referência pública consultada declara que o webhook suporta apenas `authType: NONE`. Antes da implementação, é obrigatório confirmar com a BRy se há assinatura criptográfica, segredo, cabeçalho verificável, allowlist de IPs ou outra proteção disponível.
- Mesmo com webhook, o backend deve reconciliar o estado consultando a API da BRy, tratar callbacks como não confiáveis e processá-los de forma idempotente.
- O endpoint de status documentado é `GET /api/service/sign/v1/signatures/{request_id}/status`.
- O download do PDF assinado é feito por `GET /api/service/sign/v1/signatures/{request_id}/documents/{document_id}/signed`.
- O guia médico descreve o armazenamento da BRy como temporário. A SurgiMetrics deve baixar e guardar o artefato final e suas evidências assim que o envelope terminar.

## Evidência do certificado: como o `signed` é alcançado

A Easy Sign **não** devolve, em campo legível por máquina, titular, série,
emissor ou validade do certificado, nem o padrão PAdES aplicado. O endpoint de
signatários (`GET /signatures/{requestId}/signers`) traz apenas `status`,
`evidenceDate` e `signatureConfig{mode, hashAlgorithm, profile}` — e `profile` é
a configuração **solicitada**, não o resultado. Os relatórios `/report` e
`/reportunified` são PDFs.

Em 29/10/2026 a BRy orientou o caminho correto: **baixar o PDF assinado e
submetê-lo a um serviço de verificação**, que responde em JSON. As duas opções
indicadas foram o **HUB Signer** (“Verifica uma assinatura PDF/PAdES”) e a
**API BRy Verifica**. A implementação usa o HUB Signer, cujo contrato é o mais
completo:

```
POST /api/pdf-verification-service/v1/signatures/verify   (multipart/form-data)
  signatures[0][nonce], signatures[0][content]
```

| Evidência exigida | Campo na resposta da verificação |
| --- | --- |
| Titular do certificado | `signatureStatus.chainStatus.certificateStatusList[].certificateInfo.subjectDN` (`formattedCn` / `cn` / `dn`) |
| Número de série | `...certificateInfo.serial` |
| Emissor | `...certificateInfo.issuerDN` (`cn` / `dn` / `o`) |
| Validade do certificado | `...certificateInfo.validity.notBefore` / `notAfter` |
| Instante da assinatura | `signatureStatus.signingTime` |
| Resultado geral | `generalStatus` (aceitos: `VALID`, `VALID_WITH_ALERT`) |
| Formato | `signatureFormat` (exigido: `PADES`) |

### O nível PAdES ainda não vem pronto — e como ele é derivado

A verificação devolve `signatureFormat: "PADES"`, mas **não** devolve o nível
(`B-B`, `B-T`, `B-LT`, `B-LTA`). Como o nível não pode ser deduzido do modo
solicitado, ele é derivado de evidência do próprio artefato:

- carimbo do tempo **reconhecido pela verificação** → `PAdES-B-T`;
- sem carimbo reconhecido, e sem carimbo pedido → `PAdES-B-B`;
- carimbo **pedido** e não confirmado → **nada é declarado**: a tentativa fica
  pendente com `verify_timestamp_not_verified`, porque isso é uma divergência,
  não um nível menor;
- `B-LT` e `B-LTA` **nunca** são declarados: esta resposta não comprova
  arquivamento. Subdeclarar é seguro; superdeclarar não.

### O que ainda precisa de confirmação da BRy

1. **O host oficial do serviço de verificação.** A documentação pública usa
   `example.com` como placeholder. Por isso `BRY_VERIFY_BASE_URL` é obrigatória
   e a allowlist aceita apenas o domínio `bry.com.br`; nenhum subdomínio foi
   inventado.
2. **Qual entrada de `certificateStatusList` é a do signatário.** A própria
   documentação pede para confirmar com resposta real. A implementação prefere a
   entrada marcada como final (`certificateType`/`cpf`), ignora a do carimbo e,
   na falta de marcação, usa a última da cadeia — sempre conferindo os campos
   obrigatórios depois.
3. **Se `signatureStatus` vem como objeto ou lista** quando há mais de uma
   assinatura. As duas formas são tratadas.
4. **Se a verificação consome crédito** e qual o custo por documento. É uma
   segunda API, com cobrança possivelmente separada da Easy Sign.
5. **Se o certificado precisa ser conferido como ICP-Brasil** a partir de
   `certificateType`, além do modo `QUALIFIED` solicitado.

Até 1 e 4 estarem resolvidos, a integração permanece desligada.

### Retenção de 30 dias

A BRy informou que o documento assinado e os relatórios ficam disponíveis por
**até 30 dias**. A reconciliação baixa e arquiva o artefato na primeira vez que
encontra o envelope concluído, e verificações posteriores releem o PDF do nosso
bucket privado — não da BRy. Resta um risco operacional: se nenhuma
reconciliação acontecer dentro de 30 dias (webhook perdido e ninguém clicando em
“Atualizar status”), o artefato é perdido na origem. Mitigação sugerida, ainda
**não** implementada: incluir tentativas pendentes antigas na rotina diária de
alertas que já existe.

## Divergências entre o schema publicado e a API ao vivo

Encontradas em **29/10/2026**, em teste real de ponta a ponta contra
`easysign.bry.com.br`. Cada uma teria derrubado a primeira assinatura de
verdade. Nenhuma está no OpenAPI publicado.

| Campo | Schema publicado | API ao vivo | Erro que a API devolve |
| --- | --- | --- | --- |
| `signersData[].typeMessaging` | string (`LINK`/`EMAIL`/`WHATSAPP`) | **array de string** | `cannot unmarshal string into Go struct field CreateCollection.signersData of type []string` |
| `documents[].base64document` | `base64document` | **`base64Document`** | — (silenciosamente ignorado) |
| `name` / `clientName` | sem limite documentado | **máximo 50 caracteres** | `Error validating tag 'max' of field 'Name' in object 'CreateCollection.Name'` |
| resposta: `signers[].signatureConfig.mode` | `mode` | **`signatureMode`** | — (leitura devolvia `null`) |
| `metadata` com modo `SIMPLE` | não documentado | **rejeitado** | `signer metadata can't be used with 'SIMPLE' signature mode` |
| `access_token` | “validade de alguns minutos” | **28.800 s (8 h)** | — |

Observações do mesmo teste:

- os valores de `metadata` são **strings simples**, como no guia médico
  (`"2.16.76.1.12.1.3": ""`), e não listas;
- o OID do tipo de documento, os três OIDs do CFM e
  `signatureConfig: {mode: QUALIFIED, hashAlgorithm: SHA256, profile: TIMESTAMP}`
  foram **aceitos** e devolvidos pela API;
- a criação **devolve o link de assinatura mesmo em rascunho**, com
  `canSign: false`; depois do `/start` o envelope vai para `CREATED` e o
  signatário fica apto;
- `DELETE` do envelope funciona e foi usado para limpar todos os testes.

## Divergências registradas na documentação da BRy

Registradas aqui em vez de resolvidas por suposição:

1. ~~**Modo da assinatura médica.**~~ **Resolvido em 29/10/2026.** A BRy
   confirmou **`QUALIFIED`** para receita e pedido de exame, por exigir
   certificado ICP-Brasil conforme CFM e ITI, com `hashAlgorithm: SHA256` e
   `profile: TIMESTAMP` (que também é o padrão quando `profile` é omitido).
   A implementação continua não escolhendo o modo sozinha — ele vem de
   `BRY_EASY_SIGN_SIGNATURE_MODE` — e `QUALIFIED` nunca é rebaixado.
2. ~~**Caixa do campo do documento em Base64.**~~ **Resolvido em 29/10/2026:**
   o correto é **`base64Document`**, com “D” maiúsculo, como no Quickstart. O
   schema público grafa `base64document` e a BRy vai corrigir a documentação.
   A implementação foi corrigida — antes enviava a grafia errada e a primeira
   chamada real teria falhado.
3. **Identificador do envelope.** A resposta de criação devolve o envelope em
   `uuid` (descrito como “Request_id criado para o envio”), não em `requestId`.
   A implementação lê `uuid`.
4. **Autenticação do webhook.** A referência pública declara `authType: NONE`,
   e a BRy **confirmou em 29/10/2026 que não há outra opção hoje**. A
   implementação trata o callback apenas como notificação, protegida por
   segredo de endpoint próprio, e **sempre** reconsulta a BRy com JWT antes de
   qualquer transição.
5. **OIDs médicos não têm campo próprio.** O endpoint de criação não define campo
   de OID: eles vão como **chaves** em `documents[].metadata` (OID do tipo de
   documento, com valor vazio) e em `signersData[].metadata` (OIDs do CFM, com os
   valores reais). A implementação segue o guia médico.

## Decisões de implementação

### Configuração (todas server-side, nunca com prefixo `VITE_`)

| Variável | Papel | Comportamento sem valor válido |
| --- | --- | --- |
| `BRY_EASY_SIGN_ENABLED` | Fonte de verdade da feature flag, resolvida no backend | Integração indisponível |
| `BRY_EASY_SIGN_BASE_URL` | Host da BRy, com allowlist de `easysign.bry.com.br` e `easysign.hom.bry.com.br` | Indisponível — **nunca** cai em produção por omissão |
| `BRY_EASY_SIGN_CLIENT_ID` | ID da aplicação, trocado por JWT a cada chamada | Indisponível |
| `BRY_EASY_SIGN_CLIENT_SECRET` | API-Key da aplicação; não expira, só server-side | Indisponível |
| `BRY_EASY_SIGN_TOKEN_URL` | Host da autenticação, com allowlist (`cloud` / `cloud-hom`) | Indisponível |
| `BRY_EASY_SIGN_TOKEN_TIMEOUT_MS` | Timeout da troca de token (padrão 15.000) | Usa 15.000 |
| `BRY_EASY_SIGN_TOKEN` | Opcional; só para o Quickstart de homologação. Credenciais de aplicação sempre vencem | Ignorado |
| `BRY_EASY_SIGN_CREDENTIAL_ID` | UUID **opaco** emitido pelo cofre; validado como UUID | Indisponível |
| `BRY_EASY_SIGN_SIGNATURE_MODE` | `SIMPLE` / `ADVANCED` / `QUALIFIED` | Indisponível |
| `BRY_EASY_SIGN_SIGNATURE_PROFILE` | Perfil PAdES/carimbo; obrigatório fora de `SIMPLE` | Indisponível |
| `BRY_EASY_SIGN_HASH_ALGORITHM` | Algoritmo de hash (padrão `SHA256`) | Usa `SHA256` |
| `BRY_EASY_SIGN_WEBHOOK_SECRET` | Segredo do endpoint de callback, mínimo 32 caracteres | Webhook responde 404 |
| `BRY_EASY_SIGN_REQUEST_TIMEOUT_MS` | Timeout por chamada (1.000–60.000; padrão 20.000) | Usa 20.000 |

Verificação da assinatura (segunda API, sem a qual nenhuma tentativa vira `signed`):

| Variável | Papel | Comportamento sem valor válido |
| --- | --- | --- |
| `BRY_VERIFY_BASE_URL` | Host do serviço de verificação; allowlist do domínio `bry.com.br` | Tentativa fica pendente com `verify_service_not_configured` |
| `BRY_VERIFY_TOKEN` | JWT do serviço de verificação, só no header | Idem |
| `BRY_VERIFY_PATH` | Caminho do endpoint (padrão: o documentado) | Usa o padrão |
| `BRY_VERIFY_REQUEST_TIMEOUT_MS` | Timeout (1.000–60.000; padrão 30.000) | Usa 30.000 |

Sem configuração completa a UI mostra “integração indisponível” e mantém a via
manual. Os nomes estão em `.env.example` **sem valores reais**.

### Endpoints da BRy utilizados

| Operação | Chamada |
| --- | --- |
| Obter/renovar o JWT | `POST {cloud}/token-service/jwt` |
| Criar envelope (como rascunho) | `POST /api/service/sign/v1/signatures` |
| Iniciar o envelope | `POST /api/service/sign/v1/signatures/{requestId}/start` |
| Consultar envelope | `GET /api/service/sign/v1/signatures/{requestId}` |
| Baixar PDF assinado | `GET /api/service/sign/v1/signatures/{requestId}/documents/{documentNonce}/signed` |
| Relatório de evidências | `GET /api/service/sign/v1/signatures/{requestId}/documents/{documentNonce}/report` |
| Cancelar envelope | `DELETE /api/service/sign/v1/signatures/{requestId}` |
| Listagem de envelopes (conferência manual de órfão) | `POST /api/service/list/v1/create` |
| Verificar a assinatura (**outra API**) | `POST /api/pdf-verification-service/v1/signatures/verify` |

### Arquitetura

- **Nenhuma função serverless nova.** As ações foram consolidadas em
  `api/secure-profile.js` (o projeto está em 12/12 funções no plano Hobby da
  Vercel), roteadas por `?action=`:
  `clinical-signature-state`, `clinical-signature-request`,
  `clinical-signature-link`, `clinical-signature-reconcile`,
  `clinical-signature-abandon`, `clinical-signature-artifact` e `bry-webhook`.
- **O webhook é roteado antes da autenticação de usuário**; todas as outras
  ações exigem sessão Supabase válida, clínica resolvida por `data_owner_id()` e
  `has_clinical_access()` confirmado.
- **A verificação é isolada em `api/_lib/bryVerify.js`**, separada do cliente de
  assinatura porque é outra API, com outro host, outro token e possivelmente
  outra cobrança. Ela nunca é consultada antes de o artefato existir.
- **Comunicação externa isolada** em `api/_lib/bryEasySign.js`: allowlist de
  host, `AbortController`, limite de resposta, recusa de redirecionamento,
  verificação de que o download é realmente PDF, classificação de erros
  (`config`/`timeout`/`network`/`auth`/`rate_limit`/`not_found`/`provider`/
  `invalid_response`/`too_large`) e sanitização de mensagens.
- **PDF determinístico** em `api/_lib/clinicalDocumentPdf.js` com `pdf-lib`
  (sem Chromium/headless na Vercel): datas e produtor fixos,
  `useObjectStreams: false`, fontes padrão Helvetica, normalização estável de
  caracteres fora da codificação. O mesmo documento sempre gera os mesmos bytes
  e o mesmo SHA-256.
- **`CLINICAL_SIGNATURE_RENDERING_VERSION` evoluiu de `clinical-pdf-v1` para
  `clinical-pdf-v2`**, porque agora existe um renderizador no servidor que
  define os bytes assinados. Tentativas v1 preservam a versão antiga.
- **Migration aditiva e idempotente** `supabase/clinical_signature_bry_schema.sql`,
  aplicada depois de `clinical_signature_readiness_schema.sql`. Não reescreve a
  migration anterior.

### Resultado ambíguo de `POST` (sem idempotency key na BRy)

A API não oferece chave de idempotência para a criação de envelope. Seguindo a
orientação da BRy de 29/10/2026, o envelope é criado com **`startAsDraft: true`**
e um **`name` único por tentativa** (o id da tentativa), e só depois iniciado por
`POST /signatures/{uuid}/start`. Consequência: se a criação der timeout e um
envelope duplicado existir, ele fica em rascunho e **não chega ao profissional** —
nenhuma notificação é enviada e nada pode ser assinado.

Mesmo assim o resultado continua sendo tratado como ambíguo: timeout, erro de
rede ou 5xx em `POST` **nunca** são reenviados automaticamente. A tentativa fica
`pending` com `dispatch_state = 'unknown'` e `failure_code = 'dispatch_result_unknown'`,
e a mensagem ao profissional explica que um envelope órfão, se existir, ficou em
rascunho e que o risco é crédito consumido. A saída é a ação humana explícita
“Encerrar tentativa”.

Se a criação funcionar mas o **início** falhar, o envelope já está registrado:
a tentativa fica com `provider_envelope_status = 'DRAFT'` e
`failure_code = 'envelope_start_failed'`, o link não é entregue (assinar ainda
não é possível) e “Atualizar status” reinicia o envelope sem cobrar de novo.

Para localizar um envelope órfão, a BRy indicou a **página de listagem de
envelopes** da aplicação (`POST /api/service/list/v1/create`, exibível em
iframe). É uma página para pessoas, não uma busca programática — por isso o
`name` único por tentativa é o que torna a conferência manual viável. Não há
recuperação automática, e isso é intencional.

### Segurança

- Não existe JWT fixo: o backend troca `client_id` + `client_secret` por um
  `access_token` de poucos minutos (`api/_lib/bryToken.js`), guarda em cache na
  memória do processo apenas enquanto vale, renova com 30 s de folga e
  compartilha uma única troca entre chamadas concorrentes. O token **nunca** é
  persistido. Se a autenticação falhar, o corpo do erro não é propagado, porque
  a BRy pode ecoar a requisição — que contém o `client_secret`.
- O `client_secret` existe somente em variável server-side e **nunca** aparece em
  query string, log, banco, telemetria ou resposta de API. O token vai apenas no
  header `Authorization`. Mensagens de erro passam por sanitização que remove `Bearer`, JWTs e URLs.
- O link individual de assinatura é tratado como sensível: devolvido somente ao
  próprio profissional autor, **nunca persistido** nem registrado em log, e
  aberto com `noopener,noreferrer` (sem aparecer no DOM). Como ele não fica
  guardado, “Abrir página de assinatura” (`clinical-signature-link`) reabre a
  página consultando o envelope na BRy — sem criar envelope novo e sem consumir
  crédito. Essa é a saída para pop-up bloqueado ou aba fechada; antes dela, a
  única alternativa era criar outro envelope.
- Nenhuma escrita nas tabelas de assinatura parte do navegador: `insert`,
  `update` e `delete` seguem revogados para `authenticated`.
- Nada enviado pelo frontend é confiado: `ownerId`, autoria, CRM, CPF, caminhos e
  status são sempre relidos do banco com a service role. O `requestId` é apenas
  chave idempotente e não concede autoridade.
- O caminho do artefato é gerado pelo servidor em
  `clinical-signatures/<clínica>/<documento>/<tentativa>.pdf` e reconferido na
  abertura; nenhum caminho devolvido pela BRy é aceito.
- O bucket `clinical-signatures` é privado, aceita somente `application/pdf`,
  tem política de leitura escopada por clínica e é escrito apenas pela service
  role. A abertura exige sessão, acesso clínico e auditoria, e gera URL assinada
  de 60 segundos.
- Identificadores externos (envelope, documento, signatário, ambiente), o hash do
  PDF submetido e o artefato persistido são imutáveis depois de gravados; estados
  terminais são congelados e nenhuma tentativa pode ser apagada.
- Ambiente e modo pedido integram a identidade imutável da conexão: trocar
  qualquer um exige criar uma nova conexão, preservando o histórico. Conexões
  criadas antes desta migration têm esses campos nulos e precisam ser recriadas
  para registrar ambiente/modo.

### Testes

- Unitários: `tests/unit/bryEasySign.spec.js` (41), `tests/unit/bryVerify.spec.js` (15),
  `tests/unit/clinicalDocumentPdf.spec.js` (11), `tests/unit/clinicalSignatureBryUi.spec.js` (14),
  `tests/unit/clinicalSignatureBryBackend.spec.js` (41).
- PostgreSQL descartável: `tests/postgres/clinicalSignatureBry.spec.sql`
  (instalação limpa, reaplicação, upgrade sem apagar histórico, RLS
  cross-clínica, imutabilidade, unicidade/idempotência, estados terminais,
  políticas do Storage).
- E2E: `tests/e2e/clinical-signature-bry.spec.js` (13).
- Mocks existem somente nos testes; **nenhuma requisição real à BRy** é feita.

## Encaixe na arquitetura clínica existente

A implementação futura deve respeitar a especificação [Preparação para assinatura clínica ICP-Brasil](./superpowers/specs/2026-10-21-clinical-signature-readiness-design.md):

- `clinical_documents` continua sendo a fonte imutável do documento emitido;
- cada envio à BRy cria uma tentativa append-only, sem reescrever o documento;
- somente o backend cria envelopes, usa o token e baixa artefatos;
- certificado A1/A3, chave privada, senha e token da BRy não são armazenados no frontend nem no Supabase;
- o signatário precisa coincidir com o autor e com o snapshot de nome, conselho, CRM e CPF do documento;
- uma assinatura só aparece como concluída quando houver PDF persistido, SHA-256, padrão de assinatura, instante e evidências públicas do certificado;
- impressão e assinatura manual permanecem disponíveis durante o rollout e para documentos legados;
- callbacks da BRy são normalizados para os estados internos, sem tornar um payload externo a fonte de verdade clínica.

Fluxo proposto para a implementação posterior:

```text
documento clínico imutável
  -> renderização determinística do PDF + SHA-256
  -> tentativa local pending
  -> envelope BRy + vínculo pelos UUIDs externos
  -> página BRy para o profissional assinar
  -> webhook não confiável + reconciliação autenticada por consulta
  -> download do PDF final
  -> validação de integridade/evidências
  -> armazenamento privado e tentativa signed
```

## Perguntas obrigatórias antes de implementar

### Produto e cobrança

- Qual é o custo por envelope, documento, signatário, modalidade, OTP, WhatsApp, biometria, carimbo do tempo, relatório e download?
- Uma tentativa que falha, expira ou é cancelada consome créditos? Reenvio consome novamente?
- Há homologação disponível para a conta Self-Service? Se houver, ela usa token e créditos diferentes?
- O crédito inicial e a recarga mínima continuam válidos na data da contratação?

### Credenciais e isolamento

- A integração usa uma única aplicação BRy da SurgiMetrics ou uma aplicação por clínica?
- Como funcionam expiração, renovação, rotação, revogação e escopos do JWT?
- O profissional autentica seu certificado apenas na página BRy ou existe algum cadastro/vínculo anterior?
- A página funciona em iframe e em navegador móvel para certificados A1, A3 e certificados em nuvem?

### Assinatura clínica

- Para prescrição e solicitação de exame, o modo correto é `QUALIFIED` ou o `ADVANCED` do exemplo médico? Qual perfil PAdES/carimbo do tempo deve ser usado?
- Quais OIDs e campos são obrigatórios para receita, pedido de exames, relatório e registro de atendimento?
- Quais dados públicos do certificado e da cadeia são devolvidos pela API ou pelo relatório?
- Há endpoint de validação técnica do PDF e de obtenção do relatório de evidências que possa ser arquivado junto ao documento?
- O fluxo atende às regras vigentes para os tipos clínicos da SurgiMetrics? Medicamentos controlados e sujeitos à retenção continuam fora do escopo até validação jurídica/regulatória específica.

### Operação e segurança

- Como autenticar callbacks? Qual é a política de retry, timeout, ordenação e duplicidade dos webhooks?
- Por quanto tempo documentos originais, parciais, finais e relatórios ficam disponíveis? Como `keepDocument` afeta prazo e créditos?
- Quais limites de tamanho, quantidade de documentos/signatários, rate limit e prazo máximo do envelope se aplicam ao plano Self-Service?
- Qual é o procedimento de contingência para indisponibilidade da BRy e para envelopes presos em estado intermediário?
- Quais são os termos de tratamento de dados, suboperadores, localização, retenção e descarte aplicáveis a dados de saúde/LGPD?

## Checklist de homologação

### Já implementado e testado (sem contato real com a BRy)

- [x] Cliente HTTP isolado, com allowlist de host, timeout, limites e erros classificados.
- [x] Token apenas em header server-side; ausente de log, banco, query string e respostas.
- [x] PDF determinístico no servidor, com SHA-256 reproduzível e testes.
- [x] OIDs por tipo de documento e metadados CFM (registro, UF, especialidade), conforme confirmado pela BRy.
- [x] `QUALIFIED` sem downgrade automático para `ADVANCED`.
- [x] `base64Document` com a caixa correta.
- [x] Envelope criado como rascunho e iniciado em segunda chamada, com `name` único por tentativa.
- [x] Evidência do certificado obtida do serviço de verificação e gravada; `signed` alcançável.
- [x] Nível PAdES derivado de carimbo verificado, nunca do modo pedido; `B-LT`/`B-LTA` nunca declarados.
- [x] Artefato relido do bucket privado nas verificações seguintes, sem depender da retenção de 30 dias.
- [x] Página de assinatura reabrível sem criar envelope novo, para pop-up bloqueado ou aba fechada.
- [x] Tentativa append-only e idempotente; estados terminais imutáveis.
- [x] Resultado ambíguo de `POST` sem reenvio cego, com encerramento humano explícito.
- [x] Webhook tratado como notificação, com segredo de endpoint e reconciliação autenticada.
- [x] Callback duplicado, adulterado, atrasado e fora de ordem cobertos por teste.
- [x] Bucket privado por clínica, abertura autenticada e auditada com URL de 60 s.
- [x] Via manual preservada em todos os estados.
- [x] Feature flag desligada por padrão, com falha fechada e mensagens sanitizadas.

### Respondido pela BRy em 29/10/2026

- [x] Fonte da evidência verificável: baixar o PDF assinado e submetê-lo ao serviço de verificação (HUB Signer ou API BRy Verifica), que responde em JSON.
- [x] Modo para documento médico: `QUALIFIED`, com `SHA256` e `profile: TIMESTAMP`.
- [x] Caixa do campo Base64: `base64Document`.
- [x] Proteção do webhook: somente `authType: NONE`.
- [x] Envelope órfão após `POST` ambíguo: criar como rascunho com `name` único e conferir pela página de listagem antes de repetir.
- [x] Retenção do documento assinado e dos relatórios: até 30 dias.

### Ainda depende da BRy (bloqueia a ativação)

- [ ] **Host oficial do serviço de verificação.** A documentação pública usa `example.com`;
      sem ele `BRY_VERIFY_BASE_URL` não pode ser preenchida e `signed` segue inalcançável.
- [ ] **Se a verificação consome crédito** e qual o custo por documento (é uma segunda API).
- [ ] Confirmar, com resposta real, qual entrada de `certificateStatusList` é a do signatário
      e se `signatureStatus` vem como objeto ou lista.
- [ ] Confirmar se o `/start` é idempotente para um envelope que já saiu de `DRAFT`.
- [ ] Confirmar contrato, preços por operação, validade dos créditos, impostos e estorno.
- [ ] Confirmar se há homologação disponível para a conta Self-Service e se usa token/créditos próprios.
- [ ] Confirmar efeito de `keepDocument`, limites de tamanho e rate limit.
- [ ] Confirmar termos de tratamento de dados de saúde, suboperadores, localização e descarte (LGPD).

### Passos de ativação, em ordem

1. Criar a aplicação no BRy Cloud, gerar as credenciais e guardar `client_id` e
   `client_secret`; **não** colar em ticket, chat ou repositório. Não há JWT para
   guardar: ele é obtido a cada chamada.
2. Resolver os itens “Ainda depende da BRy” acima — principalmente o host e o custo
   da verificação — e registrar as respostas neste documento.
3. ~~Aplicar `supabase/clinical_signature_bry_schema.sql`.~~ **Feito em 28/10/2026.**
4. Configurar as variáveis com `BRY_EASY_SIGN_ENABLED=false` e
   `BRY_EASY_SIGN_BASE_URL=https://easysign.hom.bry.com.br`, para validar que a UI
   reporta “indisponível” sem a flag.
5. Cadastrar o webhook no BRy Cloud apontando para
   `/api/secure-profile?action=bry-webhook`, com o segredo de endpoint.
6. Ativar a flag **somente em homologação** e assinar um pedido de exames de teste com
   certificado autorizado, medindo o crédito consumido.
7. Conferir no banco: envelope/documento/signatário gravados, `rendered_pdf_sha256`,
   artefato e relatório no bucket privado e, com o verificador configurado,
   `status = 'signed'` com certificado, validade, instante e `signature_standard`
   preenchidos. Sem o verificador, `evidence_gap_code = 'verify_service_not_configured'`.
8. Exercitar webhook duplicado, atrasado e adulterado, além de timeout e encerramento
   de tentativa ambígua.
9. Validar a página da BRy no desktop e no celular, com certificado A1, A3 e em nuvem.
10. Validar com resposta real do verificador quais campos vêm preenchidos e ajustar
    `selectSignerCertificate`/`hasVerifiedTimestamp` se a forma divergir do schema.
11. Ativar em produção apenas após a clínica aprovar, mantendo a via manual disponível.
