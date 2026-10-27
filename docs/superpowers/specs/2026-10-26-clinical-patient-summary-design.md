# Spec — Ficha clínica: resumo do paciente

Data: 2026-10-26
Status: implementada na branch `feat/clinical-workspace-views`

## Objetivo

Criar uma primeira leitura segura da ficha antes de o profissional entrar em um formulário específico.

## Conteúdo

- Último contato clínico.
- Próximo compromisso vinculado.
- Quantidade de planos ativos e pendências.
- Alergias e medicamentos em uso vindos do perfil clínico já carregado.
- Cinco eventos recentes por metadados.
- Atalhos para evolução, documentos, fotos e plano.

## Segurança

- O Resumo só renderiza depois que a abertura da ficha foi auditada com sucesso.
- Falha na auditoria mantém todo o conteúdo bloqueado.
- O resumo não replica evolução, hipótese diagnóstica ou respostas completas de anamnese.
- O cabeçalho continua mostrando alertas independentemente da aba escolhida.

## Navegação

- Busca e lista de pacientes abrem o Resumo.
- Atendimento vindo da Agenda abre diretamente o Prontuário para preservar o fluxo de consulta.
- O profissional pode voltar ao Resumo sem uma segunda gravação de auditoria na mesma abertura.

## Implementação

- `CLINICAL_TABS` adiciona `overview` como primeira aba; `ClinicalPatientSummary` monta cards e atalhos.
- O índice do paciente vem de `buildClinicalWorkspaceIndex`; alertas vêm do perfil clínico carregado após a auditoria.
- Atalhos alteram somente a aba local (`record`, `prescriptions`, `files` ou `treatment`).
- O E2E confirma que a busca abre Resumo, enquanto um item da agenda abre Prontuário.

## Aceitação

- A aba Resumo é a primeira da ficha.
- Estados sem plano, agenda ou histórico são explícitos.
- Atalhos apenas navegam; nenhuma ação clínica é executada automaticamente.
