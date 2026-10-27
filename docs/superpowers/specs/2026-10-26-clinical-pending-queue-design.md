# Spec — Clínico: fila de pendências

Data: 2026-10-26
Status: implementada na branch `feat/clinical-workspace-views`

## Objetivo

Converter registros já existentes em uma fila clínica acionável, sem criar diagnóstico, prescrição, cobrança ou tarefa automaticamente.

## Regras de derivação

- **Aguardando paciente:** link de pré-anamnese pendente e ainda válido.
- **Revisão clínica:** submissão mais recente posterior à última anamnese assinada.
- **Assinatura:** tentativa mais recente do documento em `pending` ou `failed`.
- **Retorno vencido:** última data indicada no prontuário já passou e não existe atendimento posterior vinculado.
- **Revisão de plano:** versão atual de plano ativo com `review_on` vencido.
- **Sessão sem conclusão:** evento mais recente está agendado/reagendado no passado.

## Comportamento

- Filtros por categoria sem mutação de dados.
- Cada item abre o paciente no módulo adequado.
- Resolver significa navegar para a fonte; a fila não altera registros por conta própria.

## Segurança e honestidade

- A fila usa apenas metadados necessários.
- Retornos usam `list_clinical_workspace_record_metadata`, RPC somente leitura sem evolução/conduta e com checagem explícita de proprietário e acesso clínico.
- Documentos sem tentativa digital permanecem “via manual” e não viram falsa pendência.
- Tentativas antigas de assinatura não prevalecem sobre uma assinatura posterior concluída.
- Fontes indisponíveis são sinalizadas; a ausência não é apresentada como “zero”.

## Implementação

- `ClinicalPendingView` fornece contagem, filtros e navegação para a ficha; não possui operação de escrita.
- `buildClinicalWorkspaceIndex` concentra todas as regras temporais e escolhe somente a versão/tentativa mais recente quando aplicável.
- `clinicalWorkspaceIndexClient.js` consulta as fontes em paralelo e registra em `unavailableSources` qualquer fonte ausente.
- `clinical_workspace_views_schema.sql` cria a RPC idempotente de metadados do prontuário; o teste PostgreSQL valida isolamento e reaplicação.

## Aceitação

- A rota `/app/clinical-pending` exige acesso clínico.
- Itens vencidos e revisões são determinísticos e testados por funções puras.
- Não há escrita automática no prontuário, agenda ou plano.
