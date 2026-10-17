# Spec — Fundação clínica e prontuário imutável (Fase 4.0–4.1)

Data: 2026-10-16 · direção de produto atualizada em 2026-10-17
Status: fundação implementada; workspace “Amigo essencial” aprovado para as próximas etapas

## Goal

Abrir a área Clínica com prontuário cronológico, autoria profissional, correções por adendo e acesso auditável, sem expor anamnese a perfis meramente administrativos.

## Contexto e navegação

A Fase 4 começa pela fundação porque pedidos, receitas, documentos e assinatura dependem da mesma identidade profissional e do mesmo isolamento de dados. A navegação passa a conter a área **Clínico**, que será um workspace único para o profissional. O cadastro administrativo permanece em Relacionamento → Pacientes.

## Direção aprovada — “Amigo essencial”

Toda a experiência assistencial abaixo pertence à área **Clínico**. Ela não deve ser repartida entre Relacionamento, Atendimentos, Financeiro ou Configurações, embora essas áreas possam oferecer atalhos para o mesmo paciente ou atendimento sem duplicar dados.

1. **Interface clínica compacta:** alta densidade de informação, sem cards executivos grandes e sem ocupar a tela com indicadores administrativos.
2. **Agenda do dia como entrada:** ao entrar em Clínico, o profissional vê a fila do dia e abre o paciente diretamente pelo atendimento.
3. **Ficha central do paciente:** identificação e alertas clínicos permanecem visíveis enquanto o profissional alterna entre os módulos do paciente.
4. **Prontuário, anamnese e histórico:** evoluções imutáveis, adendos, anamnese e linha do tempo ficam na mesma ficha.
5. **Pedidos de exames e receitas em PDF:** criação, consulta e reimpressão pertencem à ficha clínica; a primeira versão gera o documento sem depender de integração externa.
6. **Fotos e documentos:** anexos clínicos, termos e comparação antes/depois ficam no paciente, protegidos pelo acesso clínico.
7. **Plano de tratamento e retorno:** conduta, etapas, sessões e próxima revisão ficam junto do histórico clínico e podem alimentar a agenda sem criar um cadastro paralelo.

### Organização da tela

- **Entrada:** Agenda do dia.
- **Busca auxiliar:** localizar outro paciente sem sair de Clínico.
- **Contexto persistente:** cabeçalho compacto do paciente com identificação, alergias/alertas e próximo retorno.
- **Módulos da ficha:** Resumo, Prontuário, Anamnese, Exames e receitas, Fotos e documentos, Plano e retorno.
- **Regra de navegação:** abrir um atendimento seleciona o paciente e mantém o usuário no mesmo workspace clínico.
- **Regra de dados:** agenda geral, cadastro administrativo e ficha clínica podem mostrar o mesmo paciente/atendimento, mas sempre referenciam o mesmo registro-fonte.

### Fora da primeira versão

Transcrição de consulta, teleconsulta e resultados automáticos de laboratório ficam adiados. Não são dependências nem bloqueadores do “Amigo essencial”.

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

## Próximas etapas

1. Transformar a entrada de Clínico no workspace compacto com Agenda do dia e ficha central.
2. Entregar anamnese versionada e link público de uso único. O plano antigo de 2026-10-08 não deve ser executado literalmente: ele expunha nome e conteúdo clínico no link público e não consumia o token de forma atômica.
3. Adicionar pedidos/receitas em PDF, fotos/documentos e plano de tratamento/retorno dentro da mesma ficha.
