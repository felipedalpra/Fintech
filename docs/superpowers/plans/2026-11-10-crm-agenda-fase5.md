# CRM — Fase 5 · Agenda Comercial (calendário estilo Monday)

Branch: `feat/crm-agenda` (a partir da `main` atualizada em 2026-11-10, `dc3a77e`) · Prompt de origem: `Docs/PROMPT-FASE5.md` (fora do repositório).

## 1. Goal
Substituir o "em breve" da aba **CRM → Agenda** por um calendário (mês / semana / dia) que centraliza as atividades comerciais da clínica, com filtros combináveis, criação de tarefa/follow-up, painel de detalhes e reagendamento por arrastar — **sem segunda agenda e sem duplicar dados**.

## 2. O que já existia (reaproveitado, não refeito)
- **Atendimentos** (`Calendar.jsx` + `clinicalCalendar.js`): consultas e cirurgias de `data.consultations` / `data.surgeries`, com as regras de reagendamento (competência e vencimento acompanham a data, Google Agenda).
- **Tarefas** (`useTaskWorkspace`, `TaskDrawer`, `NewTaskModal`, `updateTask` com read-back e `task_history`).
- **CRM** (`useCrmWorkspace`): oportunidades com `next_action` / `next_action_due`, responsável, `updateOpp` (otimista com rollback) e `syncTask`.

## 3. Decisões
- **A Agenda é uma visão derivada** (`src/lib/crmAgenda.js`, puro). Cada evento guarda `{ source, recordId }` do registro original. Nenhuma tabela nova e **nenhuma migração**.
- **Tipos**
  | Tipo | Origem |
  |---|---|
  | Consulta | `data.consultations` |
  | Cirurgia | `data.surgeries` (cirurgias cadastradas) |
  | Follow-up | tarefa Ligar/WhatsApp/Retorno **ligada a oportunidade**; ou próxima ação (`next_action_due`) de oportunidade **aberta** |
  | Orçamento | tarefa da categoria Orçamento; ou próxima ação de oportunidade na etapa Orçamento Enviado |
  | Tarefa | demais tarefas com prazo |
- **Status unificado** para o filtro: *em aberto/agendado*, *atrasado* (prazo vencido e não concluído) e *concluído/realizado* (tarefa feita; consulta/cirurgia com data passada).
- **Responsável de consulta/cirurgia**: elas não têm responsável próprio; herdam o da oportunidade **aberta** mais recente do paciente (indicado como "responsável pela oportunidade do paciente"). Sem oportunidade, ficam em "Sem responsável".
- **Reagendar**
  - Tarefas e follow-ups/orçamentos **abertos**: arrastar grava `due_date`/`due_time` na tarefa (`updateTask`, read-back + `task_history`) ou `next_action_due` na oportunidade (`patchOpportunity`).
  - **Consultas e cirurgias não são arrastadas no CRM**: o painel leva a Atendimentos, onde valem as regras do módulo (valores, competência e vencimento acompanham a data).
  - Bloqueado: data passada, atividade concluída, próxima ação sem a migração da Fase 1 do CRM.
- **Criar** (clique em dia/horário vazio ou "Nova atividade"): reutiliza o `NewTaskModal` da página Tarefas, agora exportado e com modo **Follow-up**, que cria a mesma tarefa ligada à oportunidade e ao paciente dela.
- **Detalhes**: tarefa abre o **mesmo `TaskDrawer`** da página Tarefas; consulta/cirurgia/próxima ação abre um painel lateral com título, descrição, paciente, responsável, data/hora, status, tipo e links para o registro original.
- **Fuso**: `CLINIC_TIME_ZONE = 'America/Sao_Paulo'` (a clínica não tem fuso no cadastro; é o mesmo dos relatórios e do prontuário). "Hoje", "atrasado" e a linha de "agora" usam esse fuso.
- **Valores financeiros não aparecem** na Agenda comercial (Equipe acessa o CRM, mas não o financeiro).

## 4. Propagação
| Ação na Agenda | Onde muda | Como |
|---|---|---|
| Arrastar/editar tarefa | Página Tarefas, subitens e atrasadas do CRM, Meu Dia, Sino | Mesmo registro `tasks`; estado do CRM recebe `syncTask` sem recarregar |
| Arrastar próxima ação | Coluna Prazo da Tabela, filtros de prazo, Kanban | `ws.updateOpp` (estado único do CRM) |
| Criar tarefa/follow-up | Tarefas, subitens da oportunidade, Meu Dia, Sino | `createTask` (mesmo caminho da página Tarefas) |
| Editar tarefa no editor da oportunidade aberto da Agenda | Agenda | `CrmWorkspace` repassa a mudança para `useTaskWorkspace.syncTask` |
| Consulta/cirurgia | **não muda** pela Agenda do CRM | só leitura; link para Atendimentos |

Nada financeiro é tocado: competência, vencimento e caixa não mudam a partir da Agenda.

## 5. Permissões
- Aba disponível para quem acessa o CRM (`funnel`). Consultas só para quem acessa `consultations` e cirurgias só para quem acessa `calendar`.
- Escritas passam pelas mesmas funções e RLS de sempre; o read-back de `updateTask` impede um "salvo" falso quando a RLS recusa.

## 6. Checklist de fidedignidade
1. **Sem duplicar:** a unit confere que cada evento referencia o registro original e que oportunidade perdida/arquivada e tarefa sem prazo não entram.
2. **Propagou?** e2e: arrastar envia `PATCH` de `tasks` (`due_date`) e de `opportunities` (`next_action_due`); criar follow-up envia `POST` de `tasks` com `opportunity_id` e `patient_id`.
3. **3 datas:** não toca (consultas/cirurgias são só leitura aqui).
4. **Regras:** data passada é recusada sem escrita (unit + e2e); concluída e consulta/cirurgia não arrastam (unit).
5. **Fuso:** unit confere 01:30 UTC = 22:30 do dia anterior em Brasília.
6. **Testes:** `tests/unit/crmAgenda.spec.js`, `tests/e2e/crm-agenda.spec.js`; regressão em `crm-workspace.spec.js` e `tasks-panel.spec.js`.

## 7. Fora do escopo (Fase 5)
Automações, Realtime de tarefas (as mudanças feitas por outras pessoas aparecem ao reabrir a aba), reagendar consulta/cirurgia pelo CRM, recorrência.
