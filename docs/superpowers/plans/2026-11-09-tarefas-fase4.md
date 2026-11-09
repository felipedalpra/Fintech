# Tarefas · Fase 4 — reformulação estilo Monday

Branch: `feat/crm-workspace-fase3` (Fases 3 e 4 na mesma branch, a pedido do sócio) · Prompt: `Docs/PROMPT-FASE4.md` (fora do repositório).

## 1. Goal
Página Tarefas como gerenciador de trabalho: Kanban compacto e configurável, filtros combináveis, tabela interativa e painel lateral — sem recriar o sistema de tarefas.

## 2. O que já existia (preservado)
- `tasks` (status `pendente`/`aguardando`/`feita`, tipo, hora, desfecho + `task_attempts`), usado por CRM (subitens), Meu Dia, Sino, esteiras e regras de follow-up.
- Desfecho (`registerTaskAttempt`), atalho de WhatsApp, "Nova tarefa avulsa", Minhas/Todas.
- Células do CRM (`CrmCells`), Atualizações da Fase 3 (comentários com menção), Sino do CRM.

## 3. Decisões
- **Status não muda.** Colunas = `task_stages` com `base_status`; "Em andamento" é coluna de status `pendente`. Coluna efetiva derivada (`stageOf`). Trigger `tasks_stage_sync`: escolher coluna ajusta status/conclusão; mudar status por outra tela libera coluna incompatível.
- Colunas padrão (uma por status) não podem ser removidas; status base de coluna é imutável. Configurar colunas: admin/gestão (RLS + `crm_can_manage_workspace`).
- **Categoria = `task_type`** (já existia). **Responsável único** (o campo atual — múltiplos responsáveis mudariam Meu Dia/Sino/CRM).
- Subtarefas = `task_checklist_items` (não viram tarefas, para não poluir Meu Dia/Sino).
- Comentários = `task_comments` com o mesmo componente `UpdatesThread` da oportunidade.
- Histórico = `task_history` append-only via trigger.

## 4. Propagação
| Ação | Onde aparece | Observação |
|---|---|---|
| Mover card entre colunas | Kanban, Tabela, CRM (subitem), Meu Dia, Sino | Status muda pelo banco; `pendente`/`aguardando` seguem abertas |
| Concluir/reabrir, desfecho | Todas as telas de tarefa | Mesmos caminhos de antes (`toggleTask`, `registerTaskAttempt`) |
| Prioridade/descrição/subtarefas/comentários | Página Tarefas | Campos novos; nada derivado em outras telas |
| Excluir tarefa | Todas | Leva checklist, comentários e histórico junto (cascade) |

Nada financeiro é tocado.

## 5. Checklist de fidedignidade
1. **Status íntegro:** teste SQL cobre coluna→status, saída de concluída limpa desfecho, status externo libera coluna, inserções de outros módulos inalteradas.
2. **Nenhuma tarefa some do quadro:** unit garante uma coluna para cada status e soma das colunas = total.
3. **Isolamento:** coluna/comentário/checklist de outra clínica rejeitados (teste SQL).
4. **Sem mock em fluxo real:** sem a migração, colunas fixas e avisos.
5. **Testes:** `tests/unit/taskWorkspace.spec.js`, `tests/e2e/tasks-workspace-fase4.spec.js`, `tests/postgres/tasksWorkspacePhase4.spec.sql`, e2e antigos de Tarefas (desfecho, WhatsApp, nova avulsa).
