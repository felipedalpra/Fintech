# BRy Easy Sign — referência para a integração clínica

## Estado deste documento

- Informações comerciais recebidas em **28/10/2026** para uma futura integração da SurgiMetrics com a API BRy Easy Sign no modelo Self-Service.
- Referência técnica conferida na documentação pública da BRy na mesma data.
- Esta etapa é somente de descoberta e registro: **nenhuma credencial foi recebida ou armazenada, nenhum crédito foi comprado e nenhuma integração foi ativada**.
- Condições comerciais e comportamento da API devem ser reconfirmados com a BRy antes da implementação, pois podem mudar.

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

## Checklist para a futura homologação

- [ ] Confirmar contrato, preços, ambiente e política de créditos.
- [ ] Criar aplicação no BRy Cloud sem copiar o token para tickets, chat ou repositório.
- [ ] Definir armazenamento seguro, rotação e alerta de expiração do token.
- [ ] Homologar pedido de exame e receita simples com um certificado autorizado.
- [ ] Validar modo ICP-Brasil, perfil PAdES, carimbo do tempo, OIDs e relatório.
- [ ] Validar fluxo no desktop, celular e retorno da página BRy.
- [ ] Testar webhook duplicado, fora de ordem, atrasado, adulterado e indisponível.
- [ ] Confirmar reconciliação por polling e idempotência de criação/download.
- [ ] Conferir SHA-256, certificado, cadeia, data, autoria e persistência privada do PDF.
- [ ] Medir créditos consumidos por cada cenário de sucesso, falha, expiração e reenvio.
- [ ] Manter a via manual disponível até a homologação completa.

