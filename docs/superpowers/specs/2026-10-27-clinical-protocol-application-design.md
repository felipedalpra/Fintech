# Spec — Aplicação operacional de protocolos clínicos

Data: 2026-10-27
Status: implementada na branch `feat/protocolos-aplicacao-paciente`

## Objetivo

Transformar a Biblioteca de Protocolos em um ponto de partida para o atendimento, mantendo o protocolo como modelo revisável e nunca como decisão ou registro automático.

## Fluxo principal

1. O profissional seleciona “Aplicar em paciente” em um protocolo ativo.
2. Escolhe um paciente ativo da clínica.
3. Escolhe Anamnese, Pedido de exames, Receita simples ou Plano e retorno.
4. A ficha passa pela auditoria obrigatória de abertura.
5. O destino abre em modo de edição com um rascunho preenchido.
6. O profissional revisa, complementa e confirma usando o fluxo normal daquele registro.

## Destinos

- **Anamnese:** preenche plano terapêutico, orientações e perguntas complementares; campos obrigatórios continuam validados antes da assinatura.
- **Pedido de exames:** preenche kit de exames, indicação-base e orientações.
- **Receita simples:** preenche medicamentos favoritos, sem marcar a confirmação sanitária; disponível somente ao perfil que já pode prescrever.
- **Plano e retorno:** preenche indicação, objetivos, tratamento, orientações e etapas/retornos como rascunhos.

Destino sem conteúdo correspondente fica indisponível. Protocolo arquivado não pode ser aplicado a um novo atendimento.

## Biblioteca

- Visualizar apresenta indicação, objetivos, tratamento, orientações e listas configuradas.
- Histórico permite inspecionar todas as versões imutáveis.
- Aplicar, criar uma nova versão ou duplicar a partir do histórico usa exatamente a versão exibida, identificada também no modal de aplicação.
- Nova versão preserva o contrato existente.
- Duplicar cria um novo protocolo independente, inicialmente nomeado “Cópia de …”.
- Arquivar e reativar permanecem em Mais ações.

## Segurança e integridade

- A seleção de paciente usa somente pacientes ativos já autorizados para a clínica.
- O seletor mostra nome, data de nascimento e contato, além de repetir a identidade escolhida antes da confirmação.
- Abrir a ficha continua exigindo `log_clinical_record_access` antes de renderizar conteúdo clínico.
- Antes de abrir o rascunho, o cliente relê a biblioteca e bloqueia a aplicação se o protocolo tiver sido arquivado ou se a versão não estiver mais disponível.
- A anamnese leva consigo o snapshot da versão escolhida para renderizar e validar as perguntas mesmo se uma recarga posterior da biblioteca falhar; o banco continua sendo a autoridade na assinatura.
- Etapas de plano preservam o deslocamento em dias e recalculam sua data quando o início previsto muda. Uma data de etapa editada manualmente deixa de seguir o cálculo automático.
- Nenhuma aplicação chama RPC de gravação; somente os botões finais do destino registram ou emitem dados.
- Nenhuma migration ou permissão nova é introduzida.

## Implementação

- `ClinicalProtocols.jsx` implementa detalhe, histórico, duplicação e seletor paciente/destino.
- `ClinicalRecords.jsx` transporta o rascunho até a ficha auditada.
- `ClinicalDocuments.jsx` e `ClinicalTreatmentPlan.jsx` recebem aplicações iniciais de consumo único.
- `clinicalProtocols.js` mantém transformações puras e testáveis dos rascunhos.

## Aceitação

- Um protocolo ativo pode abrir um rascunho no paciente selecionado em cada destino compatível.
- Cancelar ou navegar sem confirmar não persiste nada.
- Receita permanece bloqueada para perfil sem permissão.
- Histórico e duplicação não modificam versões existentes.
- Fluxo funciona em desktop e mobile.
