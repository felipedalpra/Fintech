# Spec — Clínico: protocolos como módulo

Data: 2026-10-26
Status: navegação implementada; regras do protocolo preservadas

## Objetivo

Promover a biblioteca de protocolos já existente a um módulo clínico próprio, em vez de escondê-la como botão dentro da ficha.

## Escopo funcional

- Rota dedicada `/app/clinical-protocols`.
- Item próprio na subnavegação do Clínico e nas abas horizontais do workspace.
- Owner/admin clínico continua podendo criar, versionar e arquivar.
- Outros perfis clínicos continuam com consulta e aplicação revisável.

## Regras preservadas

- Protocolos são modelos, nunca ordens automáticas.
- Aplicar um protocolo apenas preenche rascunhos revisáveis.
- Nenhum protocolo diagnostica, prescreve, assina anamnese ou grava evolução sozinho.
- Versões antigas permanecem como snapshot nos registros que as utilizaram.

## Implementação

- `FinanceWorkspace.jsx` registra `/app/clinical-protocols`; `ClinicalRecords.jsx` apresenta a rota nas abas do módulo.
- A tela reutiliza `ClinicalProtocols` e seus contratos atuais, sem criar novo estado ou persistência.
- `canManage` continua limitado a owner/admin e o fechamento navega para `/app/clinical-records`.
- A suíte `clinical-protocols.spec.js` segue cobrindo criação, aplicação revisável e autoria.

## Aceitação

- Acesso continua dependente de `clinical_access`, não do cargo administrativo isolado.
- A rota não duplica a biblioteca ou cria uma nova tabela.
- O botão voltar retorna para Hoje.
