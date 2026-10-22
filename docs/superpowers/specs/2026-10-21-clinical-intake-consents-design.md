# Anamnese pública e consentimentos versionados

## 1. Objetivo

Permitir que a clínica envie ao paciente um link temporário para preencher uma anamnese pré-consulta personalizada e aceitar TCLE/consentimentos versionados. A resposta do paciente é uma fonte declarada e separada: ela nunca vira anamnese SOAP assinada pelo profissional sem revisão clínica explícita.

## 2. Usuários e problema

- profissional com acesso clínico: prepara o formulário, seleciona os termos, gera o link e revisa a resposta;
- paciente: abre um link opaco, preenche somente os campos daquela solicitação e confirma os termos;
- clínica: preserva versões, autoria declarada, histórico de envio e evidência do aceite sem expor o prontuário na URL.

## 3. Escopo

- modelos de anamnese com campos estruturados de texto, texto longo, data, seleção, múltipla seleção e sim/não;
- termos de consentimento/TCLE imutáveis e versionados;
- solicitação vinculada a um paciente, com token aleatório armazenado apenas como hash, validade configurável e uso único;
- página pública sem autenticação que mostra somente o formulário e os termos vinculados;
- submissão atômica, idempotente e imutável;
- painel clínico para criar modelos, termos, convites, copiar o link, revogar e revisar respostas;
- ação de usar a resposta como rascunho da nova anamnese SOAP, sem assinatura automática.

Ficam fora: assinatura ICP-Brasil, biometria, reconhecimento facial, carimbo de tempo qualificado, WhatsApp automático e diagnóstico gerado automaticamente.

## 4. Fluxo e estados

```text
modelo ativo + termos publicados
             │
             └── convite ──> pendente ──> enviado/aberto ──> respondido
                                  │                            │
                                  ├── expirado                 └── revisão clínica
                                  └── revogado                       │
                                                                  rascunho SOAP
                                                                       │
                                                            assinatura profissional explícita
```

O token é consumido somente na submissão confirmada. Reabrir a página antes de enviar não altera o estado clínico. Respostas, aceites e termos usados permanecem imutáveis.

## 5. Segurança e privacidade

1. A URL contém apenas um token de 256 bits, sem paciente, clínica ou tipo de procedimento.
2. O banco guarda somente SHA-256 do token; o valor bruto é retornado uma única vez ao profissional.
3. O link expira em até sete dias e pode ser revogado antes do uso.
4. RPCs públicas devolvem somente título da clínica, formulário e termos daquela solicitação; nunca CPF, telefone, e-mail, prontuário ou nome completo do paciente.
5. A submissão usa bloqueio de linha e consome o token na mesma transação que grava resposta e aceites.
6. `anon` não possui acesso direto às tabelas. A superfície pública é limitada a duas RPCs.
7. Conteúdo informado pelo paciente é rotulado como declaração do paciente e não recebe autoria profissional.
8. O aceite eletrônico é uma evidência operacional; a interface não o chama de assinatura digital ou ICP-Brasil.

## 6. Modelo de dados e propagação

| Origem | Transformação | Persistência | Consumidor |
|---|---|---|---|
| modelo clínico ativo | snapshot de definição validada | `clinical_intake_requests.template_snapshot` | formulário público e revisão |
| termo publicado | snapshot + SHA-256 do conteúdo | `clinical_intake_request_consents` | página pública e evidência |
| token aleatório | SHA-256 no banco | `clinical_intake_requests.token_hash` | validação das RPCs públicas |
| respostas do paciente | validação por definição e limites | `clinical_intake_submissions.answers` | revisão clínica |
| aceite explícito | cópia imutável do termo e declaração | `clinical_consent_acceptances` | histórico clínico e auditoria |
| resposta revisada | mapeamento somente para campos compatíveis | estado local do editor SOAP | assinatura profissional posterior |

O prontuário canônico, a anamnese SOAP e os documentos clínicos atuais não são alterados pela submissão pública. A única propagação possível para `clinical_anamneses` ocorre quando o profissional revisa, completa e assina uma nova versão pelo fluxo existente.

## 7. Contratos de interface

- `create_clinical_intake_template`: cria uma versão imutável do modelo.
- `create_clinical_consent_template`: cria uma versão imutável de termo/TCLE.
- `create_clinical_intake_request`: valida paciente, modelos e termos da clínica; gera o token e devolve o valor bruto uma vez.
- `revoke_clinical_intake_request`: revoga somente convites ainda pendentes.
- `get_public_clinical_intake`: resolve o token sem registrar resposta e sem expor PII.
- `submit_public_clinical_intake`: valida e grava resposta/aceites atomicamente; repetição com o mesmo identificador retorna a submissão existente.
- leituras autenticadas usam RLS por `data_owner_id()` e `has_clinical_access()`.

## 8. Falhas e recuperação

- token inválido, expirado, revogado ou usado: mensagem genérica, sem confirmar existência do paciente;
- queda após envio: o `request_id` idempotente impede resposta duplicada;
- termo obrigatório não aceito: nenhuma linha é gravada;
- definição inválida: o convite não é criado;
- falha ao carregar o painel: anamnese SOAP existente continua disponível;
- revogação concorrente com envio: o bloqueio da solicitação determina um único resultado terminal.

## 9. Compatibilidade e rollout

1. Aplicar `supabase/clinical_intake_consents_schema.sql` depois dos SQLs de prontuário e anamnese.
2. Publicar o frontend somente depois da migration; a aba de anamnese existente não é modificada no banco.
3. Criar ao menos um modelo e um termo, gerar um convite de homologação e enviar uma resposta de teste.
4. Conferir resposta após recarregar e criar uma anamnese SOAP somente depois da revisão.
5. Homologar o texto jurídico dos termos com a clínica antes do uso real.

## 10. Testes

- unitários: definição, respostas, termos obrigatórios e mapeamento para rascunho SOAP;
- PostgreSQL: instalação, RLS entre clínicas, token não persistido em claro, uso único, idempotência, expiração/revogação e imutabilidade;
- E2E: criar convite no painel, abrir página pública, preencher, aceitar termos, enviar, revisar e recarregar;
- regressão: `npm run test:unit` e `npm run build`.

## 11. Checklist de fidedignidade

- [x] A submissão pública não cria nem assina anamnese profissional.
- [x] Paciente, clínica e termos são validados no banco no momento do convite.
- [x] O snapshot usado pelo paciente não muda se o modelo ou termo ganhar nova versão.
- [x] Token em claro não é persistido e não carrega PII.
- [x] Resposta e aceite são gravados juntos ou não são gravados.
- [x] Convite tem um único estado terminal entre respondido, expirado e revogado.
- [x] Repetição de envio não duplica resposta nem aceite.
- [x] Conteúdo histórico não pode ser atualizado nem apagado fisicamente.
- [x] RLS usa `data_owner_id()` e `has_clinical_access()`.
- [x] Nenhum total financeiro, agenda ou cadastro do paciente é alterado.
- [x] Nenhuma função serverless nova é criada.
- [ ] Texto de cada TCLE será validado juridicamente/clinicamente antes do uso real.
- [ ] Homologação real será feita com uma solicitação descartável antes de produção.

## 12. Riscos de regressão

- migration ausente: o painel novo falha isoladamente, sem impedir a leitura da anamnese SOAP;
- links encaminhados a terceiros: mitigado por token forte, validade curta, revogação e ausência de PII na abertura;
- interpretação de aceite como assinatura qualificada: mitigado por rótulos explícitos e separação da futura integração ICP-Brasil;
- dados declarados incorretos: mitigado por revisão humana obrigatória antes de virar documento profissional.
