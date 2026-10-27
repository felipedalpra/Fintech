# Spec — Clínico: visão Hoje

Data: 2026-10-26
Status: implementada na branch `feat/clinical-workspace-views`

## Objetivo

Transformar a entrada do Clínico em uma estação de trabalho diária: agenda vinculada ao paciente e um pulso das situações que exigem continuidade do cuidado.

## Escopo funcional

- Preservar consultas e cirurgias do dia em ordem cronológica.
- Abrir o prontuário somente pelo `patient_id` explícito do atendimento.
- Mostrar contagens de pendências críticas, pré-anamneses para revisão, retornos vencidos e documentos.
- Oferecer atalhos para Pendências e Documentos sem duplicar registros.

## Fontes

- Agenda canônica já carregada pelo workspace (`consultations` e `surgeries`).
- Índice clínico somente com metadados autorizados por RLS.

## Regras de segurança

- Nome semelhante nunca vincula agenda a prontuário.
- O pulso não exibe evolução, diagnóstico, respostas da anamnese ou conteúdo de documentos.
- Abrir a ficha mantém a RPC obrigatória de auditoria `log_clinical_record_access`.

## Implementação

- `FinanceWorkspace.jsx` registra a rota e monta `ClinicalRecords` com `initialView="today"`.
- `ClinicalRecords.jsx` preserva `DayAgenda` e adiciona `ClinicalTodayInsights` abaixo da agenda.
- `clinicalWorkspaceIndex.js` calcula os contadores; `clinicalWorkspaceIndexClient.js` carrega as fontes com degradação por fonte.
- Cobertura: `clinical-records.spec.js`, `area-navigation.spec.js`, `clinicalWorkspace.spec.js` e `clinicalWorkspaceIndex.spec.js`.

## Aceitação

- A rota `/app/clinical-records` abre Hoje.
- Contadores levam à fonte correspondente.
- Falha de uma migration recente não bloqueia a agenda; a tela sinaliza fonte indisponível.
- Mobile preserva agenda, busca e navegação horizontal.
