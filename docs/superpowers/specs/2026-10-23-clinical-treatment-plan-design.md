# Plano de tratamento, sessões e retornos — design

**Status:** aprovado para implementação em 2026-10-23  
**Área:** Clínico → ficha do paciente → Plano e retorno

## 1. Goal

Organizar indicação, objetivos, conduta, sessões e retornos no prontuário do paciente, com evolução cronológica, autoria profissional, histórico preservado e vínculo explícito com a Agenda canônica.

## 2. Contexto do cliente

O módulo Clínico já reúne prontuário/evoluções, anamnese SOAP, pré-anamnese e termos, exames/receitas e fotos/documentos. A última posição ainda vazia da ficha central é Plano e retorno. A clínica precisa planejar uma sequência assistencial, acompanhar o que foi ou não realizado e programar retornos sem criar um segundo cadastro de consultas.

## 3. Área e lugar na navegação

- A funcionalidade substitui o placeholder **Plano e retorno** na ficha clínica já aberta.
- O plano nunca aparece para perfis sem `clinical_access`.
- Consultas criadas a partir de uma sessão usam a coleção canônica `consultations`; o plano guarda apenas o vínculo com o atendimento.
- Valores e pagamentos continuam sendo tratados no fluxo financeiro existente da consulta, nunca dentro do plano clínico.

## 4. Referências normativas e tradução para o produto

Esta implementação não declara, sozinha, certificação SBIS/NGS2 nem assinatura ICP-Brasil. Ela aplica os requisitos de conteúdo, cronologia, autoria, sigilo e preservação compatíveis com o estágio atual; a assinatura qualificada permanece dependente da integração BRy.

Fontes oficiais consultadas:

- [Resolução CFM nº 1.638/2002](https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2002/1638): prontuário como documento único, sigiloso e científico; identificação, anamnese, hipóteses/diagnóstico, tratamento efetuado, evolução com data/hora, procedimentos e identificação dos profissionais.
- [Resolução CFM nº 2.056/2013, modificada pela nº 2.153/2016](https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2013/2056): conteúdo mínimo da anamnese, prescrições e evoluções médicas.
- [Código de Ética Médica — Resolução CFM nº 2.217/2018](https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2018/2217): respeito à decisão do paciente, dever de esclarecimento, prontuário cronológico com data, hora, assinatura e CRM, guarda e acesso do paciente.
- [Resolução CFM nº 1.821/2007](https://sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2007/1821): integridade, confidencialidade e requisitos para eliminação do papel em prontuário eletrônico.

Decisões de produto derivadas:

1. Cada versão do plano contém indicação/resumo diagnóstico, objetivos, tratamento proposto, orientações e decisão compartilhada.
2. Toda versão nasce com data/hora do servidor e snapshot de nome, conselho e registro do médico.
3. Versões, eventos e evoluções concluídas são imutáveis; correções clínicas exigem nova versão ou adendo no prontuário.
4. Uma sessão só fica `realizada` na mesma transação que cria sua evolução no prontuário canônico.
5. Cancelamento, falta, reagendamento e encerramento são eventos append-only; nunca apagam o histórico.
6. O conteúdo clínico é protegido por RLS da clínica e `clinical_access`; escrita direta do navegador é revogada.
7. O sistema registra autoria eletrônica, mas não exibe selo de assinatura qualificada antes da integração ICP-Brasil.

## 5. Fluxo ideal

### 5.1 Criar plano

1. Médico abre a ficha do paciente e entra em **Plano e retorno**.
2. Informa título, indicação/resumo diagnóstico, objetivos, tratamento planejado, orientações/riscos/alternativas discutidos, início e data de revisão.
3. Adiciona zero ou mais sessões previstas com tipo, descrição, data, hora e duração.
4. Confirma o registro com a identidade profissional exibida.
5. Banco cria plano, versão 1, evento `active`, sessões e eventos de agendamento de forma atômica e idempotente.

### 5.2 Revisar plano

1. O médico abre um plano ativo e escolhe **Nova versão**.
2. A versão atual é copiada para edição.
3. Ao registrar, o conteúdo anterior permanece íntegro e a nova versão recebe número sequencial e nova autoria/data/hora.

### 5.3 Sessões e retorno

1. Uma sessão prevista pode ser reagendada, cancelada ou marcada como falta; cada mudança gera evento cronológico.
2. **Enviar para Agenda** cria uma consulta canônica com valor zero e situação financeira pendente, para preenchimento agora ou depois no fluxo já existente.
3. A sessão guarda o UUID dessa consulta após confirmação de persistência; repetição não cria uma segunda consulta.
4. Para concluir, o médico registra data/hora efetiva, evolução, procedimentos realizados, intercorrências, próximos passos e próximo retorno.
5. A transação cria uma evolução em `medical_records`, liga-a à sessão e grava o evento `completed`.

### 5.4 Encerrar plano

- Concluir ou cancelar exige motivo/fechamento e cria evento terminal.
- Planos encerrados continuam legíveis e não recebem novas sessões nem versões.

## 6. Modelo de dados e mapa de propagação

```text
Paciente
  └─ clinical_treatment_plans (identidade imutável do plano)
       ├─ clinical_treatment_plan_versions (conteúdo clínico versionado)
       ├─ clinical_treatment_plan_status_events (ativo/concluído/cancelado)
       └─ clinical_treatment_sessions (identidade imutável da etapa)
            └─ clinical_treatment_session_events (agenda/status/vínculo)
                 ├─ consultations (Agenda canônica, quando solicitado)
                 └─ medical_records (evolução canônica ao concluir)
```

| Origem | Escrita | Consumidores | Regra |
|---|---|---|---|
| Formulário do plano | RPC `create_clinical_treatment_plan` | Plano e histórico | operação atômica e idempotente |
| Nova versão | RPC `revise_clinical_treatment_plan` | Plano atual + seletor de versões | append-only |
| Sessão | RPCs de criar/evento/concluir | Timeline do plano | evento mais recente define estado operacional |
| Enviar para Agenda | `saveDataNow` em `consultations` + RPC de vínculo | Agenda, Google Agenda, financeiro | consulta é fonte única do compromisso |
| Concluir sessão | `medical_records` dentro da RPC | Prontuário e plano | evolução canônica única |
| Fotos/documentos | somente referência visual existente | Galeria clínica | não copiar arquivos nem metadados |

O plano não altera DRE, fluxo de caixa, contas a receber ou preço. Um compromisso enviado à Agenda nasce com valor zero; informações financeiras são preenchidas no modal canônico da consulta.

## 7. Pontos de integração/automação

- **Agenda:** criação explícita e idempotente de consulta; nenhum agendamento automático silencioso.
- **Google Agenda:** herda o comportamento da consulta canônica quando a sincronização estiver conectada.
- **WhatsApp:** lembretes de retorno podem usar a consulta canônica; nenhuma mensagem automática nova nesta entrega.
- **BRy/ICP-Brasil:** futura assinatura PAdES poderá assinar a versão do plano/evolução; até lá, a UI fala em “registrar versão”, não em assinatura qualificada.
- **Financeiro:** permanece independente e canônico; não há preço, pagamento ou total no schema clínico.

## 8. Permissões

| Ação | Perfil com `clinical_access` | Médico com identidade CRM configurada |
|---|---:|---:|
| Ler plano/sessões | sim | sim |
| Criar/revisar/encerrar plano | não | sim |
| Criar/reagendar/cancelar sessão | não | sim |
| Concluir sessão/evolução | não | sim |
| Criar consulta na Agenda | conforme acesso operacional existente | sim |

RLS sempre exige `user_id = data_owner_id()` e paciente da mesma clínica. A RPC resolve autoria pela sessão autenticada; campos de autoria enviados pelo navegador são ignorados.

## 9. Mapa de arquivos

- `supabase/clinical_treatment_plans_schema.sql` — tabelas, RLS, imutabilidade e RPCs.
- `src/lib/clinicalTreatment.js` — validação e transformação puras.
- `src/lib/clinicalTreatmentClient.js` — leitura clínica autenticada no Supabase.
- `src/components/ClinicalTreatmentPlan.jsx` — interface do plano, sessões e retornos.
- `src/components/ClinicalRecords.jsx` — ativação da aba e integração com Agenda.
- `src/components/ClinicalRecords.css` — layout responsivo.
- `tests/unit/clinicalTreatment.spec.js` — regras puras.
- `tests/e2e/clinical-treatment-plan.spec.js` — fluxo no navegador.
- `tests/postgres/clinicalTreatmentPlans.spec.sql` — RLS, idempotência e imutabilidade.
- `CHANGELOG.md` e `PROJECT_MEMORY.md` — entrega e pendência de rollout.

## 10. Tasks

1. Criar migration aditiva/idempotente com tabelas append-only, índices, RLS e RPCs.
2. Criar funções puras de validação, status e integração com consulta.
3. Construir UI de criação, versões, sessões, conclusão e encerramento.
4. Integrar criação de consulta via `saveDataNow` e persistir vínculo somente depois da confirmação.
5. Exibir evolução concluída também no prontuário canônico.
6. Cobrir regras críticas em testes unitários, E2E e PostgreSQL descartável.
7. Rodar build, revisar regressões e documentar SQL manual de rollout.

## 11. Checklist de fidedignidade

- [x] Não cria prontuário, agenda ou financeiro paralelo.
- [x] Sessão realizada exige evolução persistida na mesma transação.
- [x] Data/hora e autoria vêm do servidor/sessão autenticada.
- [x] Conteúdo registrado é imutável; revisão é append-only.
- [x] Cancelamento/reagendamento preserva eventos anteriores.
- [x] RLS separa clínicas e escrita direta é revogada.
- [x] Operações críticas têm chave idempotente.
- [x] Agenda recebe vínculo explícito e não duplica consulta.
- [x] Não declara assinatura ICP-Brasil antes da BRy.
- [x] Não cria função serverless nova.
- [x] Não altera métricas financeiras.

## 12. Testes e aceitação

- Criar plano com campos obrigatórios e sessões; recarregar e recuperar tudo.
- Repetir a mesma requisição e obter o mesmo plano sem duplicação.
- Registrar nova versão sem alterar a anterior.
- Reagendar/cancelar/faltar preservando a timeline.
- Impedir conclusão sem evolução, procedimento e médico CRM identificado.
- Concluir uma vez; repetir não duplica evolução.
- Impedir update/delete direto e acesso cross-clínica.
- Criar consulta canônica uma vez e manter o vínculo após recarregar.
- Exibir corretamente no desktop e mobile.
- `npm run test:unit`, E2E direcionado, teste PostgreSQL e `npm run build` aprovados.

