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

Em 28/10/2026, foram recebidos os acessos e as condições comerciais da **BRy Easy Sign Self-Service** para a futura integração. A referência técnica, os pontos ainda não confirmados e o checklist de homologação estão em [BRy Easy Sign — referência para a integração clínica](../../BRY_EASY_SIGN_INTEGRATION.md). O registro do provedor não ativa a integração nem substitui a validação de modo ICP-Brasil, webhook, evidências, retenção, custos e tratamento de dados.

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
                      └── futura chamada server-side ──> pending
                                                        ├── signed (terminal)
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
- [ ] BRy Easy Sign, política de carimbo do tempo e armazenamento do PDF assinado serão homologados antes da ativação.
- [ ] Fluxo real será validado com certificado de homologação antes de produção.

## Rollout

1. Aplicar `supabase/clinical_signature_readiness_schema.sql` após os SQLs de documentos clínicos.
2. Publicar frontend e backend compatíveis; a ausência temporária da tabela não bloqueia o histórico/manual.
3. Homologar a BRy Easy Sign como provedor compatível com ICP-Brasil e definir cofre de segredo.
4. Implementar o adaptador dentro de endpoint consolidado existente.
5. Homologar hash, PAdES, cadeia do certificado, carimbo do tempo, revogação, download e auditoria.

