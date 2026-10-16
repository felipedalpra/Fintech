# Spec — Fundação clínica e prontuário imutável (Fase 4.0–4.1)

Data: 2026-10-16
Status: implementado na branch `feat/fase4-fundacao-prontuario`

## Goal

Abrir a área Clínica com prontuário cronológico, autoria profissional, correções por adendo e acesso auditável, sem expor anamnese a perfis meramente administrativos.

## Contexto e navegação

A Fase 4 começa pela fundação porque pedidos, receitas, documentos e assinatura dependem da mesma identidade profissional e do mesmo isolamento de dados. A navegação passa a conter **Clínico → Prontuário**. O cadastro administrativo permanece em Relacionamento → Pacientes.

## Regras de integridade

- Cargo administrativo e acesso clínico são dimensões independentes. O owner possui acesso; membros só entram quando `clinic_members.clinical_access = true`.
- Nome, conselho e registro profissional são configurados antes da assinatura; as RPCs resolvem essa identidade no banco a partir de `auth.uid()` e não confiam em autoria enviada pelo navegador.
- Uma evolução assinada nunca recebe `UPDATE` ou `DELETE`, nem pela interface nem pela RLS. Correções são novos registros em `medical_record_addenda`.
- Registros legados permanecem visíveis e são marcados como autoria não verificada; nenhum autor é inventado.
- Toda abertura, criação de evolução e criação de adendo grava ator, paciente, clínica, ação e horário em `clinical_record_access_logs`; criação e auditoria compartilham a mesma transação.
- A anamnese sai da tabela administrativa `patients` e é copiada para `patient_clinical_profiles`, protegida por RLS clínica. Um trigger de compatibilidade captura gravações de uma versão antiga durante o rollout sem manter a cópia sensível em `patients`.
- O relatório administrativo de pacientes não carrega anamnese, consentimento ou prontuário.

## Modelo de dados

| Estrutura | Responsabilidade |
|---|---|
| `clinic_members.clinical_access` | permissão clínica independente do cargo |
| `clinic_members.professional_*` | identidade profissional de membros clínicos |
| `patient_clinical_profiles` | anamnese e TCLE separados do cadastro administrativo |
| `medical_records` | evolução original, autoria e horário; imutável |
| `medical_record_addenda` | correções e complementos imutáveis |
| `clinical_record_access_logs` | trilha append-only de acesso e escrita |

## Permissões

- Owner/admin da clínica: acesso clínico e configuração dos membros.
- Membro: somente quando a permissão clínica estiver explicitamente ativa.
- Gestão, concierge e equipe sem permissão clínica: não veem a área, anamnese ou prontuário.
- RLS valida acesso clínico e `data_owner_id()`; a interface não é a barreira de segurança.

## Arquivos principais

- `supabase/clinical_record_foundation_schema.sql`
- `src/components/ClinicalRecords.jsx`
- `src/components/MedicalRecord.jsx`
- `src/components/Patients.jsx`
- `src/components/Settings.jsx`
- `src/context/UserRoleContext.jsx`
- `src/lib/clinicalRecord.js`

## Testes e aceitação

- Migração aplicada duas vezes em PostgreSQL real sem duplicar nem perder registros.
- Anamnese legada copiada antes da limpeza da tabela administrativa.
- Escrita pelo contrato legado redirecionada para a tabela clínica.
- Testes unitários validam permissão, autoria, payload e ordenação dos adendos.
- Teste de navegador assina evolução, comprova ausência de editar/excluir e registra adendo preservando o original.
- Teste de perfil operacional comprova que equipe sem permissão não recebe a área Clínica.

## Próxima etapa

Fase 4.2: anamnese versionada e link público de uso único. O plano antigo de 2026-10-08 não deve ser executado literalmente: ele expunha nome e conteúdo clínico no link público e não consumia o token de forma atômica.
