# Spec — Clínico: central de documentos

Data: 2026-10-26
Status: implementada na branch `feat/clinical-workspace-views`

## Objetivo

Permitir localizar pedidos de exames e receitas em toda a clínica sem abrir pacientes um a um.

## Escopo funcional

- Listar documentos por data, paciente, tipo e autoria.
- Buscar por paciente ou profissional.
- Filtrar por assinado, pendente, falha ou via manual.
- Abrir a ficha diretamente em Exames e receitas para imprimir, reconsultar ou continuar o fluxo permitido.

## Estado da assinatura

- Considerar somente a tentativa mais recente de cada documento.
- `signed` exige a evidência persistida pelo contrato de assinatura existente.
- Documento sem tentativa aparece como “Via manual”; nunca como assinatura pendente inventada.
- A central não ativa ICP-Brasil nem recebe certificado ou senha.

## Segurança

- O índice não carrega `document_data`, CPF, endereço ou conteúdo da prescrição.
- O conteúdo completo continua dentro da ficha auditada e protegido por RLS clínica.

## Implementação

- `FinanceWorkspace.jsx` registra `/app/clinical-documents`; `ClinicalDocumentsCenter` implementa busca, filtro e listagem.
- `buildClinicalWorkspaceIndex` une `clinical_documents` à tentativa mais recente de `clinical_document_signatures` por `document_id`.
- A abertura usa `selectPatient(patient, 'prescriptions')`, mantendo auditoria antes de montar `ClinicalDocuments`.
- Cobertura de regra em `clinicalWorkspaceIndex.spec.js` e do fluxo documental existente em `clinical-records.spec.js`.

## Aceitação

- A rota `/app/clinical-documents` exige acesso clínico.
- Filtros refletem o estado real da tentativa mais recente.
- Abrir um documento seleciona o paciente pelo ID e passa pela auditoria da ficha.
