# CRM — Gestão de Oportunidades · Fase 2 (subitens, edição em massa, menu contextual)

Branch: `feat/crm-workspace-fase2` (a partir da `main`, que já contém a Fase 1) · Prompt de origem: `Docs/PROMPT-FASE2.md` (fora do repositório).

## 1. Goal
Aproximar a Tabela do CRM da experiência do Monday com três recursos, sem refazer a Fase 1:
1. **Subitens** — expandir uma oportunidade e ver/gerir as tarefas vinculadas a ela.
2. **Seleção e edição em massa** — checkboxes + barra flutuante de ações.
3. **Menu contextual** — botão direito ou "⋯" na linha.

## 2. Contexto do cliente
A equipe comercial vive na Tabela. Hoje, para ver as tarefas de um paciente é preciso abrir o editor; mudar a etapa de 15 orçamentos é feito um a um; duplicar uma oportunidade (paciente que quer um segundo procedimento) exige recriar tudo.

Decisões tomadas com o responsável em 2026-11-07:
- **Status "Aguardando" nas tarefas:** criado (migração), e todo filtro de "tarefa aberta" passa a considerar `pendente` + `aguardando` — nada some do Sino, Meu Dia ou atrasadas.
- **Arquivar:** liberado para todos os perfis com acesso ao CRM, com confirmação. Arquivada pode ser restaurada; nada é apagado.

## 3. Área e lugar na navegação
Relacionamento → CRM → aba **Tabela** (e visualizações salvas). Kanban e Indicadores recebem o efeito das alterações, sem UI nova.

## 4. Benchmark
Monday.com: subitens com seta na primeira coluna e contador; checkbox à esquerda da linha; barra flutuante inferior "N itens selecionados" com ações; menu de contexto com ações da linha. Identidade visual SurgiMetrics (tokens de `src/theme.js`, claro/escuro).

## 5. Fluxo ideal
1. Clica na seta da oportunidade → abre a lista de subitens (tarefas) logo abaixo da linha. Contador "2/4" mostra concluídas/total.
2. No subitem: marca concluído (círculo), muda status (Pendente/Aguardando/Concluído), prazo, responsável; renomeia clicando no título. "+ Adicionar subitem" cria a tarefa já vinculada.
3. Marca checkboxes (ou o do cabeçalho do grupo) → barra flutuante: Etapa, Responsável, Prazo, Tags, Arquivar, limpar seleção (Esc).
4. Botão direito na linha (ou "⋯") → Abrir detalhes, Duplicar, Mover para etapa, Alterar responsável, Criar tarefa, Arquivar.
5. Filtro "Situação → Arquivadas" mostra as arquivadas; o menu delas oferece **Restaurar**.

## 6. Modelo de dados e propagação
Migração `supabase/crm_workspace_phase2.sql` (aditiva, idempotente):
- `tasks.status` aceita `aguardando` (amplia o check; nada é reescrito).
- `opportunities.status` aceita `arquivado`; novas colunas `archived_at`, `archived_by`, `archived_from_status` (para restaurar o desfecho original).
- RPCs *security invoker* (RLS de quem chama vale): `crm_archive_opportunities(ids)`, `crm_restore_opportunities(ids)`, `crm_add_opportunity_tags(ids, tags)`, `crm_duplicate_opportunity(id)`.

**Por que `status = 'arquivado'` e não só `archived_at`:** todas as buscas de "oportunidade aberta" do servidor (reuso de lead do WhatsApp, `create_manual_lead`, automação do funil, SLA, sugestão de IA) filtram `status = 'aberto'`. Com o status próprio, uma arquivada sai de todas elas automaticamente, sem reescrever essas funções. Uma nova mensagem do paciente cria/usa outra oportunidade, nunca a arquivada.

**Mapa de propagação:**

| Ação | Onde aparece | Observação |
|---|---|---|
| Subitem criado/editado/concluído | Tabela (contador, ⚠ atrasada), aba Tarefas do editor, página Tarefas, Meu Dia, Sino, último contato (concluída) | Mesmo registro em `tasks` (módulo existente); nenhuma tabela nova |
| Tarefa "aguardando" | Conta como aberta em todo lugar (filtros `pendente`+`aguardando`) | Esteiras só reagendam tarefas `pendente` (geradas pela trilha, sem oportunidade) — inalterado |
| Etapa em massa | Tabela, Kanban, Indicadores, `opportunity_stage_history` | Uma chamada `move_opportunity` por oportunidade (auditada), nunca escrita direta |
| Responsável/prazo em massa | Tabela, Kanban, Meu Dia (responsável) | Mesma validação do `patchOpportunity` |
| Tags em massa | Tabela (busca), Kanban | Acrescenta sem duplicar; não remove tags existentes |
| Arquivar | Some de Tabela, Kanban, Indicadores, Sino, Meu Dia, SLA, automação | Histórico de campo registra a mudança de status; restaurar devolve o status anterior |
| Duplicar | Nova oportunidade aberta na mesma etapa, mesmo paciente/contato | Copia só campos comerciais. **Não** copia paciente, mensagens, pagamentos, atendimentos, tarefas, notas, histórico, sugestão de IA nem vínculo Meta |

Nada financeiro é tocado: oportunidade não gera lançamento (regra da Fase 1).

## 7. Integração/automação
- **Risco conhecido (automação do funil):** `funnel_automation_schema.sql` não move um paciente com **duas** oportunidades abertas (caso ambíguo). Duplicar cria esse caso; a confirmação da duplicação avisa. Arquivar uma delas reativa a automação.
- WhatsApp: oportunidade arquivada deixa de receber sugestão de IA e de ser reaproveitada como lead.

## 8. Permissões
- Todas as ações: qualquer perfil com acesso ao CRM (como a edição inline da Fase 1). Isolamento por clínica via RLS (`data_owner_id`) e RPCs *security invoker*.
- Confirmação: arquivar (sempre), duplicar (sempre), e etapa/responsável/prazo quando afetam 2+ oportunidades.

## 9. Mapa de arquivos
Novos: `supabase/crm_workspace_phase2.sql`, `tests/postgres/crmWorkspacePhase2.spec.sql`, `src/lib/crmBulk.js` (puro: seleção/resumo), `src/components/CrmSubitems.jsx`, `src/components/CrmBulkBar.jsx`, `src/components/CrmRowMenu.jsx`, `tests/e2e/crm-workspace-fase2.spec.js`.
Alterados: `CrmTable.jsx` (checkbox, seta de subitens, menu), `CrmWorkspace.jsx` (seleção), `useCrmWorkspace.js` (tarefas no estado comum, ações em massa), `crmWorkspaceStore.js`, `crmWorkspace.js` (filtro/grupo Arquivadas, atrasadas derivadas), `opportunityActions.js`, `taskActions.js` (`updateTask`), `OpportunityTasks.jsx` (avisa o workspace), `CrmToolbar.jsx`, `CrmDashboard.jsx`, `CrmBell.jsx`, `MeuDia.jsx`.

## 10. Tasks
1. Migração + teste PostgreSQL.
2. Núcleo puro (filtro/grupo Arquivadas, tarefas por oportunidade, atrasadas) + unit.
3. Estado: tarefas no workspace, ações em massa, duplicar/arquivar/restaurar.
4. UI: subitens, checkboxes + barra, menu contextual.
5. Filtros de tarefa aberta (Sino, Meu Dia) e Indicadores sem arquivadas.
6. e2e + build.

## 11. Checklist de fidedignidade
1. **Soma bate?** Arquivadas saem dos totais do grupo, do ponderado e dos Indicadores (mesmo filtro em todos).
2. **Propagou?** e2e: etapa em massa aparece no Kanban; subitem concluído atualiza o contador e a aba Tarefas.
3. **3 datas:** não toca competência/vencimento/caixa. Prazo é data comercial.
4. **Sem órfão:** duplicata referencia o mesmo paciente/contato; arquivar não apaga tarefas nem notas.
5. **Pagamento:** fora do escopo.
6. **Teste:** unit + e2e + PostgreSQL.
7. **Sem mock:** sem a migração, subitens funcionam com Pendente/Concluído e as ações que dependem dela avisam que a atualização do banco está pendente.

## 12. Testes e aceitação
Ver seção 10. Rodar `npm run test:unit`, `npm run e2e -- crm-workspace` e `npm run build`.
