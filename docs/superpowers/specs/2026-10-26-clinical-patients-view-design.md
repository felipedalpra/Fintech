# Spec — Clínico: pacientes clínicos

Data: 2026-10-26
Status: implementada na branch `feat/clinical-workspace-views`

## Objetivo

Dar ao profissional uma visão de continuidade por paciente, separada do cadastro administrativo existente em Relacionamento → Pacientes.

## Escopo funcional

- Buscar paciente ativo por nome, telefone ou e-mail.
- Mostrar último contato, próximo compromisso, planos ativos, quantidades de documentos/arquivos e número de pendências.
- Priorizar pacientes com pendências e, depois, ordenar alfabeticamente.
- Abrir a ficha diretamente na aba Resumo.

## Não escopo

- Editar cadastro, CPF, endereço ou dados financeiros.
- Exibir diagnósticos, evolução, respostas de pré-anamnese ou imagens na listagem.
- Criar um segundo cadastro de paciente.

## Fontes e integridade

- `patients` continua sendo o registro-fonte da identidade.
- Agenda, prontuário, anamnese, documentos, ativos e planos fornecem somente metadados agregados.
- Toda ficha aberta passa pela auditoria já existente antes de liberar dados clínicos.

## Implementação

- `FinanceWorkspace.jsx` registra `/app/clinical-patients` e o item da navegação clínica.
- `ClinicalPatientsView` mantém busca e renderização; `buildClinicalWorkspaceIndex` agrega e ordena os indicadores.
- Selecionar um resultado chama o mesmo `selectPatient` da busca global, com aba inicial `overview`.
- Cobertura: derivação em `clinicalWorkspaceIndex.spec.js` e navegação em `clinical-records.spec.js`.

## Aceitação

- A rota `/app/clinical-patients` exige `clinical_access=true`.
- Busca funciona sem alterar a lista de pacientes.
- Paciente sem histórico aparece com estados vazios honestos.
- Nenhum texto clínico é copiado para o índice.
