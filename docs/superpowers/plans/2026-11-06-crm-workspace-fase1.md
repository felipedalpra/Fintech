# CRM — Gestão de Oportunidades · Fase 1 (workspace estilo Monday)

Branch: `feat/crm-workspace` · Prompt de origem: `Docs/PROMPT-Onboarding.md` (fora do repositório) + prints de referência do Monday.

## 1. Goal
Transformar o funil (`/app/funnel`) num workspace comercial com várias visualizações dos MESMOS dados — Tabela (padrão), Kanban, Indicadores e visualizações salvas — com edição direto na célula, grupos, colunas personalizáveis e filtros combináveis.

## 2. Contexto do cliente
A equipe comercial (secretárias, concierge, gestão) usa o CRM o dia todo. Kanban sozinho não dá densidade: querem uma tabela no estilo do Monday, rápida e editável, sem perder o que o funil já faz (movimento auditado, sugestão de IA, SLA, lead manual).

Decisões tomadas com o responsável em 2026-11-06:
- **Etapas:** manter as 8 atuais. "Cirurgia confirmada" = `cirurgia_marcada`; "Perdidos" é grupo pela situação (`status`), não etapa nova. Nome/cor/ordem/probabilidade são configuráveis.
- **Valores:** continuam visíveis para todos os perfis que acessam o funil (comportamento atual mantido).

## 3. Área e lugar na navegação
Relacionamento → **CRM** (era "Funil"; mesma rota `/app/funnel`, mesmas permissões). Abas: `Tabela | <visualizações salvas> | Kanban | Agenda (Fase 2, desabilitada) | Indicadores | + Nova visualização`. A aba ativa fica na URL (`?view=kanban`, `?view=indicators`, `?view=v-<id>`). `/app/crm-painel` continua existindo.

## 4. Benchmark
Monday.com (Main table): grupos coloridos recolhíveis, status em célula cheia, avatares, coluna "+" no fim do cabeçalho, totais por grupo, barra de ferramentas (Nova, Busca, Pessoa, Filtro, Ordenar, Ocultar, Agrupar). Identidade visual 100% SurgiMetrics (tema/tokens de `src/theme.js`, claro e escuro).

## 5. Fluxo ideal
1. Abre CRM → Tabela agrupada por etapa; Ganhos/Perdidos recolhidos no fim.
2. Clica na etapa → lista colorida → muda (RPC auditada). Clica no responsável → lista com busca. Valor/probabilidade/próxima ação → edita no lugar (Enter salva, Esc cancela). Prazo → calendário nativo.
3. Clica no nome → abre o editor existente (Dados/Tarefas/Timeline/Pessoa 360°). Ícone de observações abre direto na Timeline.
4. "+ Adicionar oportunidade" no fim do grupo cria lead já na etapa/responsável/origem/procedimento do grupo.
5. Agrupa por responsável/procedimento/origem/mês/cirurgia prevista sem mexer em nenhuma etapa.
6. Filtra (combinável) e salva como visualização pessoal ou compartilhada.
7. Troca para Kanban: mesmos dados, mesmos filtros, sem recarregar.

## 6. Modelo de dados e propagação
Migração `supabase/crm_workspace_phase1.sql` (aditiva, idempotente — já entregue e testada):
- `opportunities` + `procedure_id`, `probability` (0–100, nula = padrão da etapa), `next_action`, `next_action_due`, `expected_surgery_date`, `custom_values jsonb`.
- `crm_stage_settings` (rótulo/cor/ordem/probabilidade por clínica; chaves = as 8 atuais).
- `crm_custom_fields` (definição; arquivar, nunca apagar; tipo só muda dentro da família compatível).
- `crm_views` (pessoais: só o criador; compartilhadas: clínica vê, admin/gestão editam).
- `opportunity_field_history` (trigger append-only com autor).
- RPC `crm_last_contact` (derivada, *security invoker*).

**Mapa de propagação** — o que muda aqui muda onde:

| Edição | Onde aparece | Observação |
|---|---|---|
| Etapa (RPC `move_opportunity`) | Tabela, Kanban, Painel CRM (funil/tempo por etapa), `opportunity_stage_history`, automação forward-only | Mesmo caminho do funil; nenhuma escrita direta em `stage` |
| Valor / probabilidade | Totais do grupo, pipeline ponderado (tabela **e** Painel) | `weightedPipeline` passou a respeitar a probabilidade própria e a configurada pela clínica — mesma regra de `effectiveProbability` |
| Ganho / perdido | Grupo Ganhos/Perdidos, Painel (conversão, motivos de perda) | **Não** lança receita: financeiro continua vindo de cirurgia/consulta |
| Procedimento, próxima ação, prazo, campos personalizados | Tabela, Kanban (procedimento/follow-up/atraso), filtros | Sem efeito financeiro |
| Configuração de etapas | Tabela, Kanban, Painel (ponderado) | Chaves intocadas: automação e histórico seguem válidos |

Nada é armazenado como total: somas, distribuições, ponderado e último contato são derivados na hora.

## 7. Integração/automação
Nenhuma integração nova nesta fase. WhatsApp: botão abre a conversa (`wa.me`, mesmo comportamento do Kanban). Último contato lê mensagens existentes respeitando a RLS do número. Meta Ads/Esteiras/Agenda/Financeiro: Fases 2 e 3.

## 8. Permissões
- Acesso ao CRM: igual ao funil (`roleAccess.js` não mudou).
- Criar/alterar colunas personalizadas, configurar etapas, salvar/editar visualização compartilhada: admin/gestão (banco: `crm_can_manage_workspace()`; tela esconde/desabilita).
- Visualização pessoal: qualquer perfil, só para si.

## 9. Mapa de arquivos
Novos: `src/lib/crmStages.js`, `src/lib/crmWorkspace.js` (puro), `src/lib/crmWorkspaceStore.js` (I/O), `src/lib/useCrmWorkspace.js` (estado único), `src/components/CrmWorkspace.jsx`, `CrmTable.jsx`, `CrmCells.jsx`, `CrmToolbar.jsx`, `CrmColumnsMenu.jsx`, `CrmStageSettings.jsx`, `tests/unit/crmWorkspace.spec.js`, `tests/e2e/crm-workspace.spec.js`.
Alterados: `OpportunityPipeline.jsx` (vira a aba Kanban, sem carga própria), `OpportunityEditor.jsx` (aba inicial; informa o desfecho ao fechar), `opportunityActions.js` (`patchOpportunity` aceita os campos novos com validação), `crmMetrics.js` + `CrmDashboard.jsx` (ponderado consistente), `FinanceWorkspace.jsx` (rota/rótulo), e2e existentes do funil.

## 10. Tasks
1. Migração + teste PostgreSQL ✅ (commit `7a61933`).
2. Núcleo puro (colunas, filtros, ordenação, agrupamento, totais, campos) + unit tests ✅.
3. Estado compartilhado + camada de dados tolerante à migração ausente ✅.
4. Tabela, células, barra de ferramentas, menu de colunas, etapas, visualizações ✅.
5. Kanban sobre o estado comum ✅. 6. Ponderado consistente ✅. 7. e2e ✅.

## 11. Checklist de fidedignidade
1. **Soma bate?** Totais do grupo e ponderado são derivados das linhas filtradas (unit test de `groupSummary` e do ponderado).
2. **Propagou?** e2e edita na Tabela e confere o mesmo valor/etapa/procedimento no Kanban sem recarregar.
3. **3 datas:** não toca competência/vencimento/caixa. Prazo e cirurgia prevista são datas comerciais.
4. **Sem órfão:** procedimento removido vira "Procedimento removido" (FK `on delete set null`); campo arquivado mantém os valores.
5. **Pagamento:** fora do escopo; "ganho" explicitamente não é receita.
6. **Teste:** unit + e2e + PostgreSQL (ver seção 12).
7. **Sem mock em fluxo real:** nenhum dado fictício; sem a migração o CRM funciona com os campos atuais e avisa admin/gestão.

## 12. Testes e aceitação
- `tests/postgres/crmWorkspacePhase1.spec.sql` — 9 cenários (isolamento, permissões, validações, histórico, último contato, reaplicação).
- `tests/unit/crmWorkspace.spec.js` — 18 cenários (inclui os 3 exemplos de filtro do pedido).
- `tests/e2e/crm-workspace.spec.js` — 8 cenários (tabela padrão, edição → Kanban, rollback, agrupar sem mover, filtros no Kanban, ocultar persistente, gestão cria coluna/visualização, equipe bloqueada, migração ausente).
- e2e do funil atualizados para a nova navegação.

## Limitações conhecidas (Fase 1)
- Agenda: aba presente e desabilitada (Fase 2). Painel lateral completo (Atividades/Conversas/Orçamentos/Financeiro): Fase 2 — hoje o clique abre o editor existente.
- A preferência da Tabela principal (colunas, larguras, filtros) fica no navegador; para levar a outro dispositivo, salvar como visualização (banco).
- Campos personalizados ainda não entram no painel de filtros nem na busca (já aparecem, editam, ordenam e somam).
- Sem virtualização: cada grupo mostra 150 linhas e "Mostrar mais".
- Gravação de campo personalizado faz leitura+mescla+escrita da chave; duas pessoas editando o MESMO campo da mesma oportunidade ao mesmo tempo: vence a última.
