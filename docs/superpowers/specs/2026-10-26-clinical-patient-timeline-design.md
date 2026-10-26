# Spec — Ficha clínica: linha do tempo unificada

Data: 2026-10-26
Status: implementada na branch `feat/clinical-workspace-views`

## Objetivo

Reunir a sequência do cuidado sem criar uma tabela paralela e sem alterar as fontes clínicas imutáveis.

## Eventos apresentados

- Consultas e cirurgias da agenda.
- Evoluções do prontuário.
- Anamneses assinadas.
- Pré-anamneses recebidas.
- Pedidos de exames e receitas.
- Fotos e documentos disponíveis/arquivados.
- Versões de plano e eventos de sessão.

## Modelo

- A timeline é uma projeção somente leitura criada no cliente.
- Cada item mantém ID, tipo, data, título e autoria/descrição curta.
- A ordenação é cronológica decrescente.
- Os registros-fonte continuam responsáveis por imutabilidade, autoria e auditoria.

## Privacidade

- A projeção não copia texto de evolução, respostas, diagnóstico, conteúdo de receita ou imagens.
- Metadados de evoluções vêm da RPC `list_clinical_workspace_record_metadata`, que omite conteúdo e valida proprietário/acesso clínico explicitamente.
- A aba só existe depois da abertura auditada da ficha.
- Atualizar recarrega metadados; não grava nem corrige registros.

## Implementação

- `CLINICAL_TABS` registra `timeline`; `ClinicalPatientTimeline` renderiza a projeção e o estado vazio.
- `buildClinicalTimeline` normaliza cada fonte no contrato `{ id, type, title, detail, occurredAt }` e ordena sem mutar a origem.
- `list_clinical_workspace_record_metadata` fornece somente os campos permitidos das evoluções; as demais fontes já são consultadas por metadados.
- Testes unitários garantem a intercalação e a ausência do texto sensível; E2E cobre a abertura da aba após auditoria.

## Aceitação

- A aba Linha do tempo aparece ao lado do Prontuário.
- Eventos de todas as fontes disponíveis são intercalados por data.
- Ambiente sem uma migration recente continua utilizável e sinaliza fonte ausente.
- Teste unitário prova que o conteúdo sensível da evolução não entra na projeção.
