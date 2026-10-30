# Preparação para assinatura clínica ICP-Brasil

## Objetivo

Preparar pedidos de exames e receituários simples para uma futura assinatura eletrônica qualificada, sem simular assinatura, sem alterar o documento clínico imutável e sem guardar certificado A1 ou senha no navegador/Supabase.

## Escopo desta etapa

- registrar configuração multiprovedor por profissional usando somente uma referência opaca ao segredo mantido em cofre;
- registrar cada tentativa de assinatura separadamente, com estado, hash do conteúdo, artefato final e evidências do certificado;
- mostrar no histórico o estado real da assinatura, mantendo impressão e assinatura manual disponíveis;
- separar CPF e RQE no perfil seguro criptografado para completar a identidade do futuro signatário;
- entregar um contrato server-side testável para o adaptador do futuro provedor, sem criar função serverless nova.

Ficam fora desta etapa: upload de `.pfx`/`.p12`, senha do certificado, escolha/contratação do provedor, chamada real de assinatura, prescrição controlada e dispensação.

## Provedor recebido para homologação

Em 28/10/2026, foram recebidos os acessos e as condições comerciais da **BRy Easy Sign Self-Service**. Na mesma data o adaptador foi implementado atrás de feature flag, desligado por padrão, sem nenhuma chamada real à BRy. A referência técnica, as decisões efetivamente implementadas, as divergências da documentação e o checklist de homologação estão em [BRy Easy Sign — referência para a integração clínica](../../BRY_EASY_SIGN_INTEGRATION.md).

**Mudança de arquitetura desta etapa:** o PDF do documento clínico passou a ser renderizado no servidor de forma determinística (`api/_lib/clinicalDocumentPdf.js`, com `pdf-lib`), em vez de só existir como HTML de impressão no navegador. Por isso `CLINICAL_SIGNATURE_RENDERING_VERSION` evoluiu de `clinical-pdf-v1` para `clinical-pdf-v2`; tentativas v1 preservam a versão antiga. O envelope canônico continua sendo a base do `document_payload_sha256`, e o novo `rendered_pdf_sha256` registra os bytes efetivamente submetidos à assinatura.

**Fonte da evidência (resposta da BRy em 29/10/2026):** a Easy Sign não expõe titular/série/emissor/validade do certificado em campo legível por máquina. A evidência vem de um **segundo serviço** da BRy, de verificação de assinatura PDF/PAdES, que recebe o artefato baixado e responde em JSON (`api/_lib/bryVerify.js`). Com ele, `signed` é alcançável. O **nível** PAdES continua não vindo pronto: é derivado da presença de carimbo do tempo *reconhecido pela verificação*, nunca do modo solicitado, e `B-LT`/`B-LTA` nunca são declarados. Enquanto a verificação não estiver disponível ou não sustentar a evidência, a tentativa permanece `pending` com `evidence_gap_code`, guardando o artefato em bucket privado sem declarar assinatura.

**Criação em duas etapas (resposta da BRy em 29/10/2026):** o envelope é criado como rascunho (`startAsDraft: true`) com `name` único por tentativa e só então iniciado (`POST /signatures/{uuid}/start`). Assim, um envelope duplicado nascido de um `POST` ambíguo não notifica ninguém e não pode ser assinado; o risco passa a ser crédito consumido, não assinatura duplicada.

## Regras de segurança e fidedignidade

1. `clinical_documents` permanece a fonte imutável do conteúdo emitido.
2. `clinical_document_signatures` é aditiva: uma tentativa nunca reescreve paciente, autoria, conteúdo ou data do documento.
3. Somente o backend com credencial de serviço poderá criar/atualizar tentativas; usuários autenticados recebem apenas leitura sob RLS clínica.
4. Tentativas concluídas, falhas ou canceladas são terminais e não podem ser editadas ou apagadas.
5. A tela só usa “assinado digitalmente” quando existe evidência persistida com hash do arquivo, data, certificado e padrão de assinatura.
6. Certificado, chave privada e senha não entram em payload do navegador, banco ou logs. O backend recebe do cofre somente um UUID interno e monta `credential_reference`; o navegador não fornece a referência.
7. A via manual continua funcional durante o rollout e para documentos legados.
8. O signatário deve ser o mesmo `created_by` e corresponder ao snapshot de nome, CRM e conselho do documento; coassinatura exige um fluxo futuro explícito.
9. Remoção do profissional bloqueia novas tentativas, sem impedir o callback terminal de uma tentativa legitimamente iniciada.
10. A referência de credencial aceita somente os esquemas `vault://`, `kms://`, `hsm://` ou `provider://` seguidos de UUID emitido pelo cofre, não é selecionável pelo frontend e é imutável; rotação cria uma nova conexão.
11. Antes de chamar o provedor, o servidor confere `created_by`, nome, conselho, CRM e CPF válido do signatário contra o snapshot imutável do documento.
12. O caminho do PDF assinado é gerado pelo servidor no namespace da clínica, documento e tentativa; nenhum caminho retornado pelo provedor é confiado.

## Modelo de estados

```text
sem tentativa ──> integração não configurada / identidade incompleta
                      │
                      └── chamada server-side ──> pending
                                                   ├── pending + dispatch_state=unknown
                                                   │     (POST ambíguo; só sai por ação humana)
                                                   ├── pending + provider_envelope_status=DRAFT
                                                   │     (criado mas não iniciado; reiniciável)
                                                   ├── pending + evidence_gap_code
                                                   │     (concluída na BRy, evidência não sustentada
                                                   │      pela verificação)
                                                   ├── signed (terminal; exige evidência completa)
                                                   ├── failed (terminal)
                                                   └── cancelled (terminal)
```

## Contrato futuro do provedor

O adaptador recebe um envelope canônico gerado no servidor com:

- identificadores do documento, clínica, paciente e signatário;
- snapshot imutável já gravado em `clinical_documents`;
- versão de renderização;
- SHA-256 do envelope;
- identificador interno da credencial devolvido pelo cofre; a `credential_reference` é construída exclusivamente pelo backend.

O retorno normalizado deverá trazer o estado e, para sucesso, bytes/URL temporária do PDF assinado, SHA-256 do arquivo, padrão PAdES, instante da assinatura e metadados públicos do certificado. O caminho persistido é gerado pelo servidor em `clinical-signatures/<clinica>/<documento>/<tentativa>.pdf`; nenhum segredo ou caminho arbitrário do provedor faz parte desse retorno.

## Mapa de propagação

| Origem | Transformação | Persistência | Consumidor |
|---|---|---|---|
| Perfil seguro do médico | sanitização server-side | payload criptografado existente | checklist de identidade do signatário |
| Documento clínico imutável | envelope canônico + SHA-256 no servidor | tentativa de assinatura | futuro adaptador ICP-Brasil |
| Callback/resposta do provedor | normalização e validação | evidência terminal append-only | badge do histórico e futuro download validado |
| Ausência de integração | estado derivado, sem gravação fictícia | nenhuma | aviso “integração pendente” |

## Checklist de fidedignidade

- [x] Nenhum documento existente é atualizado ou removido.
- [x] Ausência de evidência nunca aparece como assinatura concluída.
- [x] Hash do conteúdo é gerado no servidor, não confiado ao navegador.
- [x] Tentativa assinada é terminal e imutável; uma assinatura válida não é ocultada por falha posterior.
- [x] RLS usa `data_owner_id()` e `has_clinical_access()`.
- [x] Certificado A1 e senha não são persistidos nesta estrutura.
- [x] Autor, signatário, clínica e identidade profissional são conferidos no banco.
- [x] Evidência exige padrão PAdES permitido, hash, certificado, validade e instante coerentes.
- [x] Credencial e modo de assinatura são imutáveis; rotação cria nova conexão sem apagar o histórico.
- [x] A migration atualiza com segurança a primeira versão: preserva inclusive evidências legadas duplicadas, bloqueia conexões antigas inseguras e terminaliza pendências não verificáveis com motivo auditável.
- [x] Impressão manual permanece disponível e explicitamente identificada.
- [x] Nenhuma função serverless nova é criada.
- [x] O artefato devolvido pelo provedor é baixado, hasheado e guardado em bucket privado por clínica, com abertura autenticada e auditada.
- [x] Resultado ambíguo de criação não é reenviado automaticamente e exige encerramento humano auditável.
- [x] O webhook não é fonte de verdade: toda transição vem de consulta autenticada ao provedor.
- [x] A evidência do certificado vem de verificação do próprio artefato, não da declaração do provedor.
- [x] O padrão PAdES nunca é deduzido do modo solicitado, e níveis não comprovados nunca são declarados.
- [ ] Host e custo do serviço de verificação da BRy serão confirmados antes da ativação.
- [ ] Fluxo real será validado com certificado de homologação antes de produção.

## Rollout

1. Aplicar `supabase/clinical_signature_readiness_schema.sql` após os SQLs de documentos clínicos.
2. Aplicar `supabase/clinical_signature_bry_schema.sql` (aditiva e idempotente) em seguida.
3. Publicar frontend e backend compatíveis; a ausência temporária da tabela não bloqueia o histórico/manual.
4. ~~Implementar o adaptador dentro de endpoint consolidado existente.~~ Feito em
   `api/secure-profile.js` + `api/_lib/bryEasySign.js` + `api/_lib/clinicalSignatureBry.js`,
   sem função serverless nova.
5. Homologar a BRy Easy Sign como provedor compatível com ICP-Brasil e definir cofre de segredo.
6. Configurar o serviço de verificação (`BRY_VERIFY_*`) assim que a BRy informar o host;
   sem ele a tentativa não vira `signed` e o motivo fica registrado.
7. Homologar hash, PAdES, cadeia do certificado, carimbo do tempo, revogação, download e
   auditoria com resposta real da verificação. O passo a passo está no checklist de
   [BRY_EASY_SIGN_INTEGRATION.md](../../BRY_EASY_SIGN_INTEGRATION.md).

