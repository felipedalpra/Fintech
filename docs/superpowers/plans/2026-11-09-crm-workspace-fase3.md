# CRM — Gestão de Oportunidades · Fase 3 (atualizações, visualizações iniciais, resumo por grupo)

Branch: `feat/crm-workspace-fase3` (a partir da `main`, que já contém as Fases 1 e 2) · Prompt de origem: `Docs/PROMPT-FASE3.md` (fora do repositório).

## 1. Goal
1. **Atualizações** — comentários internos na oportunidade, com resposta, @menção e notificação.
2. **Visualizações salvas** — completar o que a Fase 1 criou (`crm_views`) com as 3 visualizações iniciais e a troca de escopo.
3. **Resumo por grupo** — rodapé com quantidade, soma, ponderado e distribuição por status.

## 2. O que já existia (reaproveitado, não refeito)
- `crm_views` (Fase 1): nome, pessoal/compartilhada, filtros, agrupamento, ordenação, colunas; abas; renomear/excluir.
- `opportunity_notes`: notas internas da oportunidade (Timeline, coluna Observações, último contato).
- `CrmBell`: alertas derivados + lido/não lido em `workspace_preferences.notification_state`.
- `groupSummary` + linha de totais por coluna (Fase 1).

## 3. Decisões
- **Comentário = `opportunity_notes`** com `parent_id` (um nível; responder a uma resposta vai para o fio original) e `mentions uuid[]`. Nenhuma tabela nova de comentário.
- **Notificação = alerta "Menções" no `CrmBell`**, derivado das notas que mencionam o usuário (30 dias), sem tabela de notificações.
- **"@nome"** = parte local do e-mail (`clinic_team` só tem e-mail).
- **Meus leads** usa o token `me` no filtro de responsável → uma visualização compartilhada serve a todos.
- **Follow-ups pendentes** = oportunidade com tarefa (subitem) `pendente`/`aguardando`.
- **Orçamentos em negociação** = etapa `orcamento_enviado`, abertas.
- Visualizações iniciais criadas uma vez por clínica (`crm_ensure_default_views` + `crm_view_presets_seeded`); excluída não volta.

## 4. Modelo de dados e propagação
Migração `supabase/crm_workspace_phase3.sql` (aditiva, idempotente).

| Ação | Onde aparece | Observação |
|---|---|---|
| Atualização/resposta criada | Aba Atualizações (Realtime), Timeline, contador da coluna Observações, último contato | Mesmo registro de `opportunity_notes` |
| Menção | Sino do CRM do mencionado (Realtime) | Só de outra pessoa; menção a quem não é da clínica é descartada pelo trigger |
| Visualização inicial | Abas do CRM | Consulta os mesmos registros; nada copiado |
| Editar/mover/arquivar oportunidade | Rodapé do grupo | Derivado das linhas filtradas (`groupFooterSummary`) |

Nada financeiro é tocado (oportunidade não gera lançamento).

## 5. Permissões
- Comentar/responder/mencionar: qualquer perfil com acesso ao CRM (RLS existente de `opportunity_notes`); trigger força autor = usuário logado e a oportunidade da mesma clínica.
- Visualização compartilhada: criar/editar/tornar compartilhada só admin/gestão (RLS da Fase 1). Tornar pessoal define o dono = quem fez.

## 6. Checklist de fidedignidade
1. **Soma bate?** Rodapé = soma das linhas filtradas do grupo; ponderado = mesma regra do Painel (unit compara com `weightedPipeline`).
2. **Propagou?** e2e: nova atualização incrementa o contador; busca muda o rodapé; menção leva à oportunidade.
3. **3 datas:** não toca.
4. **Sem órfão:** resposta referencia atualização da mesma oportunidade (trigger); `on delete cascade` acompanha a nota original.
5. **Pagamento:** fora do escopo.
6. **Teste:** unit (`crmWorkspacePhase3.spec.js`), e2e (`crm-workspace-fase3.spec.js`), PostgreSQL (`crmWorkspacePhase3.spec.sql`).
7. **Sem mock:** sem a migração, comentários simples funcionam e o resto avisa/desliga.
