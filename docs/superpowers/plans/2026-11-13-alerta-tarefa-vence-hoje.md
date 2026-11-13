# Alerta proativo de tarefa que vence hoje

Data: 2026-11-13

## 1. Goal

Avisar no sininho de notificações (visível em qualquer tela) quando uma tarefa vence **hoje** — não só depois que já está atrasada, para quem pediu (Sumary) não precisar abrir a tela de Tarefas todo dia para descobrir o que tem que fazer.

## 2. Contexto do cliente

Treinamento de 12/11/2026. **Correção de atribuição:** a fala sobre isso na transcrição foi marcada como "Dr. Augusto" por erro de reconhecimento de voz — na verdade é da **Sumary** (a reunião foi com Jonas e Sumary, não com o Dr. Augusto; ver `project_training_gaps_nov2026`). Fala: "eu tenho que entrar em contato com a paciente daqui 20 dias... o sistema vai me dar essa informação ou eu tenho que ficar entrando toda hora?"

**Achado ao investigar o código (13/11/2026):** o sininho (`src/components/NotificationBell.jsx`) **já existe e já é global** — está montado em `src/pages/FinanceWorkspace.jsx` (a casca que envolve todas as áreas, não só o Financeiro), e já mostra um alerta "Tarefa atrasada" para quem tem tarefa vencida, com contador visível em qualquer tela. O gap real é mais estreito do que eu tinha avaliado antes de olhar o código: `useCrmAlerts` (dentro do próprio `NotificationBell.jsx`) só inclui `g.atrasadas` (tarefas já vencidas, `due_date < hoje`) — uma tarefa que vence **hoje** só entra no sino **no dia seguinte**, quando já está atrasada. É exatamente o caso da Sumary: no dia 20, ela queria ser avisada, não no dia 21.

## 3. Área e lugar na navegação

Nenhuma — é o mesmo sininho global que já existe, sem nova tela.

## 4. Benchmark e o que copiar

Nenhum — ajuste pontual de um alerta que já existe.

## 5. Fluxo ideal

1. No dia em que a tarefa vence, o sininho já mostra o alerta (hoje, isso só acontece no dia seguinte).
2. Alerta "Tarefa vence hoje" (cor amarela, para diferenciar de "Tarefa atrasada", que continua vermelha).
3. Clicar no alerta leva para a tela de Tarefas, igual já funciona para "Tarefa atrasada".

## 6. Modelo de dados e propagação

Nenhuma tabela nova. É só o `useCrmAlerts` (`src/components/NotificationBell.jsx:217-259`) passar a usar também `g.hoje` (grupo que `groupTasksByDue` — `src/lib/taskGroups.js` — já calcula e já existe, só não está sendo usado no sino hoje), com seu próprio tipo de alerta:

```js
g.hoje.forEach(task => list.push({
  k: `task-today-${task.id}`, type: 'Tarefa vence hoje', color: C.yellow || '#F59E0B', icon: I.clock,
  title: task.title || 'Tarefa sem título',
  desc: `${task.patients?.full_name || task.opportunities?.title || 'Pendência do CRM'} · vence hoje`,
  go: 'tarefas',
}))
```

**Mapa de propagação:** nenhum — é leitura (o mesmo `tasks` já carregado), sem escrita em registro-fonte nenhum.

## 7. Pontos de integração/automação

Nenhuma. Puramente um ajuste de leitura no componente que já existe.

## 8. Permissões

Nenhuma mudança — o sino já aparece para quem já o vê hoje (a seção CRM do sino não é gated por `canFinance`, então Jonas/Sumary (Equipe) já recebem esse alerta).

## 9. Mapa de arquivos

- `src/components/NotificationBell.jsx` — adicionar o bloco de `g.hoje` em `useCrmAlerts`.
- `CHANGELOG.md`.

## 10. Tasks

1. Adicionar o bloco de alerta "Tarefa vence hoje" em `useCrmAlerts`, com chave (`k`) própria para não colidir com "Tarefa atrasada" nem se perder no "marcar como lida".
2. Teste unitário: tarefa com `due_date` = hoje aparece no sino com o rótulo/cor certos; tarefa com `due_date` = ontem continua como "Tarefa atrasada" (sem regressão); tarefa com `due_date` = daqui a 3 dias não aparece ainda.
3. Atualizar `CHANGELOG.md`.

## 11. Checklist de fidedignidade

1. **Soma bate?** Não aplicável.
2. **Propagou?** Não há propagação a outro registro — é um recorte de leitura.
3. **As 3 datas?** Não aplicável.
4. **Sem órfão:** nenhum dado novo é criado.
5. **Estados de pagamento:** não aplicável.
6. **Teste automatizado:** task 2.
7. Sem mock; usa os mesmos dados de `tasks` já buscados pelo sino.

## 12. Testes e aceitação

- `npm run test:unit` cobrindo os três casos da task 2.
- Verificação manual: criar uma tarefa com vencimento hoje, confirmar que aparece no sino imediatamente (sem esperar o dia seguinte).
- `CHANGELOG.md` atualizado no mesmo commit.
