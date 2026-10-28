# BRy Easy Sign — referência para a integração clínica

## Estado deste documento

- Informações comerciais recebidas em **28/10/2026** para a integração da SurgiMetrics com a API BRy Easy Sign no modelo Self-Service.
- Referência técnica conferida na documentação pública da BRy na mesma data.
- **28/10/2026 — integração implementada atrás de feature flag, desligada por padrão** (branch `feat/bry-easy-sign-clinical`). Backend, banco, cliente HTTP, PDF determinístico, reconciliação, armazenamento privado e interface estão prontos e testados com mocks. **Nenhuma chamada real foi feita à BRy, nenhuma credencial foi recebida ou armazenada, nenhum crédito foi comprado e nenhuma migration foi aplicada.**
- **Bloqueio conhecido:** uma tentativa nunca atinge o estado `signed` com a API pública atual. Ver [Lacuna de evidências](#lacuna-de-evidências-bloqueio-de-ativação).
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

## Lacuna de evidências (bloqueio de ativação)

Verificado na documentação oficial da BRy em 28/10/2026, no endpoint de signatários
(`GET /api/service/sign/v1/signatures/{requestId}/signers`): a resposta devolve
`signerNonce`, `signerUuid`, `name`, `email`, `phone`, `personal_identifier`,
`status`, `canSign`, `evidenceDate`, `signatureConfig` (`mode`, `hashAlgorithm`,
`profile`), `link`, `iframe` e `metadata`.

**Não existe, em campo legível por máquina:**

| Evidência exigida pela SurgiMetrics | Disponível na API pública? |
| --- | --- |
| Titular (subject) do certificado | ❌ |
| Número de série do certificado | ❌ |
| Emissor / cadeia do certificado | ❌ |
| Validade (início/fim) do certificado | ❌ |
| Padrão PAdES efetivamente aplicado | ❌ — só `signatureConfig.profile`, que é o **pedido**, não o resultado |
| Instante da assinatura | ⚠️ `evidenceDate` (Unix timestamp), sem certificado que o sustente |

As evidências completas existem apenas como **PDF de relatório**
(`/documents/{documentNonce}/report` e `/reportunified`), que serve para
arquivamento mas não para validação programática.

Consequência implementada: como o padrão de assinatura **não pode ser deduzido do
modo solicitado** e `signed` exige evidência completa e verificável, uma tentativa
concluída na BRy fica **`pending` com `evidence_gap_code = 'bry_evidence_not_machine_readable'`**.
O PDF assinado e o relatório de evidências são baixados, conferidos, hasheados
(SHA-256) e guardados em bucket privado; a interface mostra
“Assinada na BRy · evidência pendente de homologação” e **não** afirma assinatura
qualificada. A via manual permanece disponível.

**Para desbloquear, é preciso que a BRy confirme uma destas opções:**

1. um endpoint ou campo que devolva titular, série, emissor, validade do
   certificado e o padrão PAdES aplicado, em JSON; ou
2. um relatório de evidências em formato estruturado (não só PDF); ou
3. a especificação para extrair e validar essas evidências do próprio PAdES do
   PDF baixado (ByteRange/CMS, carimbo do tempo, DSS/VRI), com o critério oficial
   de classificação em `PAdES-B-B` / `B-T` / `B-LT` / `B-LTA`.

Confirmada qualquer uma, o único ponto a mudar é a função que terminaliza a
tentativa (`collectArtifact` em `api/_lib/clinicalSignatureBry.js`), que passa a
preencher as colunas de evidência e marcar `signed`. Os guardrails de banco já
recusam `signed` incompleto.

## Divergências registradas na documentação da BRy

Registradas aqui em vez de resolvidas por suposição:

1. **Modo da assinatura médica.** O guia de assinatura médica fala em certificado
   ICP-Brasil / assinatura qualificada, mas o exemplo usa
   `"mode": "ADVANCED"` com `"profile": "TIMESTAMP"`. A implementação **não
   escolhe** o modo: ele vem de `BRY_EASY_SIGN_SIGNATURE_MODE`, e `QUALIFIED`
   **nunca** é rebaixado automaticamente para `ADVANCED`.
2. **Caixa do campo do documento em Base64.** O schema do endpoint de criação
   nomeia `base64document`, enquanto o exemplo “Completo” usa `base64Document`.
   A implementação envia `base64document` (o schema). **Confirmar com a BRy**
   qual a API aceita de fato.
3. **Identificador do envelope.** A resposta de criação devolve o envelope em
   `uuid` (descrito como “Request_id criado para o envio”), não em `requestId`.
   A implementação lê `uuid`.
4. **Autenticação do webhook.** A referência pública declara `authType: NONE`.
   A implementação trata o callback apenas como notificação, protegida por
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
| `BRY_EASY_SIGN_TOKEN` | JWT da aplicação, só no header `Authorization` | Indisponível |
| `BRY_EASY_SIGN_CREDENTIAL_ID` | UUID **opaco** emitido pelo cofre; validado como UUID | Indisponível |
| `BRY_EASY_SIGN_SIGNATURE_MODE` | `SIMPLE` / `ADVANCED` / `QUALIFIED` | Indisponível |
| `BRY_EASY_SIGN_SIGNATURE_PROFILE` | Perfil PAdES/carimbo; obrigatório fora de `SIMPLE` | Indisponível |
| `BRY_EASY_SIGN_HASH_ALGORITHM` | Algoritmo de hash (padrão `SHA256`) | Usa `SHA256` |
| `BRY_EASY_SIGN_WEBHOOK_SECRET` | Segredo do endpoint de callback, mínimo 32 caracteres | Webhook responde 404 |
| `BRY_EASY_SIGN_REQUEST_TIMEOUT_MS` | Timeout por chamada (1.000–60.000; padrão 20.000) | Usa 20.000 |

Sem configuração completa a UI mostra “integração indisponível” e mantém a via
manual. Os nomes estão em `.env.example` **sem valores reais**.

### Endpoints da BRy utilizados

| Operação | Chamada |
| --- | --- |
| Criar envelope | `POST /api/service/sign/v1/signatures` |
| Consultar envelope | `GET /api/service/sign/v1/signatures/{requestId}` |
| Baixar PDF assinado | `GET /api/service/sign/v1/signatures/{requestId}/documents/{documentNonce}/signed` |
| Relatório de evidências | `GET /api/service/sign/v1/signatures/{requestId}/documents/{documentNonce}/report` |
| Cancelar envelope | `DELETE /api/service/sign/v1/signatures/{requestId}` |

### Arquitetura

- **Nenhuma função serverless nova.** As ações foram consolidadas em
  `api/secure-profile.js` (o projeto está em 12/12 funções no plano Hobby da
  Vercel), roteadas por `?action=`:
  `clinical-signature-state`, `clinical-signature-request`,
  `clinical-signature-reconcile`, `clinical-signature-abandon`,
  `clinical-signature-artifact` e `bry-webhook`.
- **O webhook é roteado antes da autenticação de usuário**; todas as outras
  ações exigem sessão Supabase válida, clínica resolvida por `data_owner_id()` e
  `has_clinical_access()` confirmado.
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

A API pública não oferece chave de idempotência para a criação de envelope.
Portanto, timeout, erro de rede ou 5xx em `POST` são classificados como
**ambíguos** e **nunca** reenviados automaticamente. A tentativa fica
`pending` com `dispatch_state = 'unknown'` e `failure_code = 'dispatch_result_unknown'`,
e a interface avisa que o crédito pode ter sido consumido. A única saída é uma
ação humana explícita (“Encerrar tentativa”), que terminaliza como `failed` com
`dispatch_result_unknown_abandoned` e libera uma nova solicitação.

**Pendente com a BRy:** existe forma de listar envelopes por referência externa
para recuperar um envelope órfão criado nesse cenário?

### Segurança

- O token BRy existe somente em variável server-side, vai apenas no header
  `Authorization` e **nunca** em query string, log, banco, telemetria ou resposta
  de API. Mensagens de erro passam por sanitização que remove `Bearer`, JWTs e URLs.
- O link individual de assinatura é tratado como sensível: devolvido somente ao
  próprio profissional autor, **nunca persistido** nem registrado em log, e
  aberto com `noopener,noreferrer` (sem aparecer no DOM).
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

- Unitários: `tests/unit/bryEasySign.spec.js` (37), `tests/unit/clinicalDocumentPdf.spec.js` (11),
  `tests/unit/clinicalSignatureBryUi.spec.js` (14), `tests/unit/clinicalSignatureBryBackend.spec.js` (32).
- PostgreSQL descartável: `tests/postgres/clinicalSignatureBry.spec.sql`
  (instalação limpa, reaplicação, upgrade sem apagar histórico, RLS
  cross-clínica, imutabilidade, unicidade/idempotência, estados terminais,
  políticas do Storage).
- E2E: `tests/e2e/clinical-signature-bry.spec.js` (12).
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
- [x] OIDs por tipo de documento e metadados CFM (registro, UF, especialidade).
- [x] `QUALIFIED` sem downgrade automático para `ADVANCED`.
- [x] Tentativa append-only e idempotente; estados terminais imutáveis.
- [x] Resultado ambíguo de `POST` sem reenvio cego, com encerramento humano explícito.
- [x] Webhook tratado como notificação, com segredo de endpoint e reconciliação autenticada.
- [x] Callback duplicado, adulterado, atrasado e fora de ordem cobertos por teste.
- [x] Bucket privado por clínica, abertura autenticada e auditada com URL de 60 s.
- [x] Via manual preservada em todos os estados.
- [x] Feature flag desligada por padrão, com falha fechada e mensagens sanitizadas.

### Depende da BRy (bloqueia a ativação)

- [ ] **Confirmar a fonte da evidência verificável** (titular, série, emissor, validade do
      certificado e padrão PAdES aplicado). Sem isso nenhuma tentativa pode virar `signed`.
      Ver [Lacuna de evidências](#lacuna-de-evidências-bloqueio-de-ativação).
- [ ] Confirmar o modo correto para documento médico: `QUALIFIED` ou o `ADVANCED` do exemplo,
      e qual perfil PAdES/carimbo do tempo usar.
- [ ] Confirmar a caixa do campo Base64 (`base64document` vs `base64Document`).
- [ ] Confirmar se há proteção de webhook além de `authType: NONE` (assinatura, cabeçalho, allowlist de IP).
- [ ] Confirmar se existe forma de localizar um envelope órfão após `POST` ambíguo.
- [ ] Confirmar contrato, preços por operação, validade dos créditos, impostos e estorno.
- [ ] Confirmar se há homologação disponível para a conta Self-Service e se usa token/créditos próprios.
- [ ] Confirmar prazos de retenção do artefato, efeito de `keepDocument`, limites e rate limit.
- [ ] Confirmar termos de tratamento de dados de saúde, suboperadores, localização e descarte (LGPD).

### Passos de ativação, em ordem (nenhum feito até aqui)

1. Criar a aplicação no BRy Cloud e guardar o JWT em cofre; **não** colar em ticket, chat ou repositório.
2. Resolver os itens “Depende da BRy” acima e registrar as respostas neste documento.
3. Aplicar `supabase/clinical_signature_bry_schema.sql` no Supabase, depois de
   `clinical_signature_readiness_schema.sql`.
4. Configurar as variáveis com `BRY_EASY_SIGN_ENABLED=false` e
   `BRY_EASY_SIGN_BASE_URL=https://easysign.hom.bry.com.br`, para validar que a UI
   reporta “indisponível” sem a flag.
5. Cadastrar o webhook no BRy Cloud apontando para
   `/api/secure-profile?action=bry-webhook`, com o segredo de endpoint.
6. Ativar a flag **somente em homologação** e assinar um pedido de exames de teste com
   certificado autorizado, medindo o crédito consumido.
7. Conferir no banco: envelope/documento/signatário gravados, `rendered_pdf_sha256`,
   artefato e relatório no bucket privado, `evidence_gap_code` presente enquanto a
   evidência não estiver homologada.
8. Exercitar webhook duplicado, atrasado e adulterado, além de timeout e encerramento
   de tentativa ambígua.
9. Validar a página da BRy no desktop e no celular, com certificado A1, A3 e em nuvem.
10. Só depois de 2 a 9 resolvidos, implementar a terminalização para `signed` em
    `collectArtifact` e repetir a validação de evidência.
11. Ativar em produção apenas após a clínica aprovar, mantendo a via manual disponível.
