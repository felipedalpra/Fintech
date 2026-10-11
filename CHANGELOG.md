# CHANGELOG

Este projeto segue o padrão de changelog por versão, com categorias fixas:
- `Added`: novas funcionalidades
- `Changed`: alterações em comportamentos existentes
- `Fixed`: correções de bugs

## [Unreleased] - 2026-10-11 (45)
### Fixed
- **Perda de lançamentos financeiros (crítico, fidedignidade)**: lançamentos de membros da clínica (ex.: Lunara/gestão) desapareciam do Financeiro. **Causa-raiz:** ao carregar o workspace, `src/pages/FinanceWorkspace.jsx` fazia `setRaw(draftData || nextData)` — um **rascunho em cache (sessionStorage) vazio/defasado sobrescrevia o dado real do servidor**; o autosave então persistia esse estado defasado e o **`syncTable` (delete-sync) apagava do banco** as linhas ausentes no rascunho. Também, em falha de carga, o `catch` fazia `setRaw(createEmptyData())` **e** `hydratedRef=true`, armando um autosave vazio que apagava tudo. **Correções:** (1) o **servidor passa a ser a fonte de verdade** no load (`setRaw(nextData)`); o rascunho nunca sobrescreve o dado carregado — em falha de carga ele é só visualização e o autosave **não** é habilitado (`hydratedRef=false`), para um estado vazio/parcial jamais ser persistido; (2) **trava de segurança** em `src/lib/financeStore.js`: `saveFinanceData` **recusa persistir um dataset totalmente vazio** (backstop contra o wipe do delete-sync). Diagnóstico confirmou que o dado não ficou órfão nem invisível por RLS — foi efetivamente deletado; a resolução de owner (`data_owner_id()`) e a RLS estavam corretas e idênticas entre membros. Arquivos: `src/pages/FinanceWorkspace.jsx`, `src/lib/financeStore.js`.

## [Unreleased] - 2026-10-11 (44)
### Added
- **Automação de link de anamnese por WhatsApp** (CRM, Fase 2 — sub-projeto 4, incremento 4b-3): nova automação **Link de anamnese** em **Configurações → Automações** (toggle próprio, nasce desligado), enviada **N dias antes da consulta** com um **link configurável pela clínica** (campo `anamnese_link`) e template com `{patient_name}`, `{date}`, `{link}`. **Honesto / pronto-pra-credencial:** o formulário público de anamnese (token por paciente) é uma feature da Fase 4 ainda não construída — então, em vez de mandar um link quebrado, a clínica informa a URL do formulário (interno quando existir, ou externo tipo Google Forms); **sem link preenchido, a automação não envia** (fica salva). Quando o formulário interno existir, basta trocar a base do link. Reusa o motor time-based do lembrete (consultas), o cron/`?action=dispatch` e a idempotência já existentes (`automation_type='anamnese'`). Colunas `anamnese_enabled`/`anamnese_days_before`/`anamnese_link`/`anamnese_template` em `whatsapp_automations` via `alter ... add column if not exists`. Pura testada: `planAnamnese` (injeta `{link}`) em `api/_lib/whatsappAutomations.js`. UI em `src/components/WhatsAppAutomations.jsx`. Testes: `tests/unit/whatsappAutomations.spec.js` (9 no total). Com isso o sub-projeto 4 cobre as 4 automações de saída (lembrete, follow-up, cobrança, anamnese).

## [Unreleased] - 2026-10-11 (43)
### Added
- **Automação de cobrança por WhatsApp** (CRM, Fase 2 — sub-projeto 4, incremento 4b-2): nova automação **Cobrança de pagamento** em **Configurações → Automações** (toggle próprio, nasce desligado), enviada conforme o **VENCIMENTO** da conta a receber e **só para quem ainda não pagou** (`payment_status not in ('pago','cancelado')` — mesmo filtro da view `accounts_receivable`). **Regra das 3 datas respeitada:** o disparo lê o **vencimento** (coluna `due_date`), nunca competência nem caixa; o cálculo em JS (`receivableDueDate`) replica exatamente o fallback da migração de competência (cirurgia `due_date ?? date`; consulta `due_date ?? forecast_payment_date ?? date`), então funciona mesmo que `competence_date_migration.sql` ainda não tenha rodado. Prazo configurável (`payment_offset_days`: 0 = no dia do vencimento, positivo = N dias depois/atraso, negativo = antes) e template editável com `{patient_name}`, `{value}` (moeda BRL determinística via `formatBRL`) e `{date}` (vencimento). Idempotente pelo mesmo índice único do 4b-1 (`automation_type='payment'`, dedup por vencimento). Reusa o motor/cron/`?action=dispatch` já existentes — **sem função nem cron novos**. Colunas `payment_enabled`/`payment_offset_days`/`payment_template` adicionadas em `whatsapp_automations` via `alter ... add column if not exists` (idempotente) em `supabase/whatsapp_automations_schema.sql`. Lógica pura testada em `api/_lib/whatsappAutomations.js` (`formatBRL`, `receivableDueDate`, `planPayments`); orquestração `fetchReceivables` + bloco de cobrança em `runForOwner`. UI em `src/components/WhatsAppAutomations.jsx`. Testes: `tests/unit/whatsappAutomations.spec.js` (8 no total). (Link de anamnese = 4b-3.)

## [Unreleased] - 2026-10-11 (42)
### Added
- **Automações de saída de WhatsApp — lembrete e follow-up** (CRM, Fase 2 — sub-projeto 4, parte 2 / incremento 4b-1): o admin liga mensagens automáticas em **Configurações → Automações** (`WhatsAppAutomations`): **lembrete** de consulta/cirurgia (N dias antes) e **follow-up** pós-consulta (N dias depois), com template editável (variáveis `{patient_name}`, `{date}`, `{time}`) e escolha do **número de envio**. **Pronto-pra-credencial:** todo o motor existe e é testável; sem um número Z-API com credenciais, nada é enviado e a config fica salva. **Respeita o limite do Hobby (12/12 funções, 2 crons):** o código novo de servidor **reusa** `api/whatsapp.js` (novo `?action=dispatch`, autorizado por `CRON_SECRET`) e o motor vive em `api/_lib/whatsappAutomations.js`; o **disparo diário é pendurado no cron de alertas já existente** (`api/alerts/process.js`, 08:00 BRT) com chamada **fail-safe** (erro na automação nunca derruba os alertas) — sem função nem cron novos. **Idempotente:** índice único `(user_id, automation_type, ref_id, target_date)` em `whatsapp_automation_log` com guard-log **antes** do envio, impedindo 2º disparo do mesmo evento/dia. Envio grava em `whatsapp_messages` (outbound) → aparece no inbox e na timeline. **Não toca** caixa/DRE/metas (lembrete/follow-up são de calendário). Fuso **America/Sao_Paulo** no cálculo da data-alvo. Toggles nascem **desligados**. SQL em `supabase/whatsapp_automations_schema.sql` (tabelas `whatsapp_automations` + `whatsapp_automation_log`, RLS por `data_owner_id()`). Lógica pura testada: `api/_lib/whatsappAutomations.js` (`addDays`, `renderTemplate`, `planReminders`, `planFollowups`). UI: `src/components/WhatsAppAutomations.jsx` + aba em `src/components/Settings.jsx`. Design em `docs/superpowers/specs/2026-10-11-whatsapp-outbound-automations-design.md`. Testes: `tests/unit/whatsappAutomations.spec.js`. (Cobrança no vencimento = 4b-2; link de anamnese = 4b-3.)

## [Unreleased] - 2026-10-11 (41)
### Added
- **Régua de follow-up** (CRM, Fase 2 — sub-projeto 2b): o admin define **modelos de tarefa por estágio** em **Configurações → Régua de follow-up** (`FollowupRules`); quando a oportunidade **entra** num estágio, as tarefas nascem sozinhas (vencimento = entrada + N dias, responsável opcional). Dispara por **trigger no banco** em `opportunity_stage_history` → funciona pra **qualquer** caminho de mudança de estágio (manual, arrastar, IA-confirmada, automação), sem cron nem credencial. **Idempotente:** cada regra gera no máx. 1 tarefa por oportunidade (`tasks.origin_rule_id`; reentrar no estágio não recria). É o elo direto com as automações de saída (sub-projeto 4). SQL em `supabase/followup_rules_schema.sql` (tabela `followup_rules` + coluna `origin_rule_id` + função `apply_followup_rules` SECURITY DEFINER + trigger), RLS por `data_owner_id()`. `src/components/FollowupRules.jsx`, aba em `Settings.jsx`. Design em `docs/superpowers/specs/2026-10-11-followup-rules-design.md`. Teste: `tests/e2e/followup-rules.spec.js`.

## [Unreleased] - 2026-10-11 (40)
### Added
- **Painel de Tarefas** (CRM, Fase 2 — sub-projeto 2c): novo item **Pacientes → Tarefas** (`TasksPanel`) com todas as tarefas da clínica (de qualquer oportunidade **+ avulsas**) agrupadas por vencimento (⚠ Atrasadas / Hoje / Esta semana / Futuras-sem-data) e concluídas recolhidas. Filtro **Minhas / Todas** (default por papel: admin/gestão→Todas, equipe→Minhas), concluir/excluir, e **+ Nova tarefa avulsa** (título, vencimento, responsável, paciente opcional) — é onde vivem as avulsas que o schema do 2a já suporta. Cada linha mostra o vínculo (oportunidade/paciente ou "avulsa"). Visível a todos os perfis. Agrupamento é função pura testada (`src/lib/taskGroups.js`). `src/components/TasksPanel.jsx`, nav/rotas em `FinanceWorkspace.jsx`, acesso em `UserRoleContext.jsx`, ícone `tasks` em `NavIcon.jsx`. Sem SQL novo (usa `tasks` do 2a). Design em `docs/superpowers/specs/2026-10-11-tasks-panel-design.md`. Testes: `tests/unit/taskGroups.spec.js` (4), `tests/e2e/tasks-panel.spec.js`.

## [Unreleased] - 2026-10-11 (39)
### Added
- **Tarefas + Timeline na oportunidade** (CRM, Fase 2 — sub-projeto 2a): o editor da oportunidade ganhou **abas** (Dados / Tarefas / Timeline). **Tarefas** com vencimento + responsável (da equipe) + concluir/excluir; a tabela `tasks` é **geral** (nullable em `opportunity_id`/`patient_id`, já pronta pra tarefas avulsas — a tela avulsa vem no 2c). **Timeline derivada** (sem tabela de evento paralela que possa divergir): mescla `opportunity_stage_history` + `whatsapp_messages` + tarefas + criação/ganho/perdido, ordenada do mais recente. **Nota manual** (`opportunity_notes`) entra na timeline. Peça pura testada: `src/lib/timeline.js` (`buildTimeline`). `src/lib/taskActions.js`, `src/components/OpportunityTasks.jsx`, `src/components/OpportunityTimeline.jsx`, abas em `OpportunityEditor.jsx`. SQL em `supabase/tasks_timeline_schema.sql` (2 tabelas, RLS por `data_owner_id()`). Design em `docs/superpowers/specs/2026-10-11-tasks-timeline-design.md`. Testes: `tests/unit/timeline.spec.js` (6), `tests/e2e/tasks-timeline.spec.js`. (Régua de follow-up = 2b; painel "Tarefas de hoje" cross-oportunidade = 2c.)

## [Unreleased] - 2026-10-11 (38)
### Added
- **Pipeline completo** (CRM, Fase 2 — sub-projeto 1c): o funil agora é operável de ponta a ponta. (1) **Criar/editar oportunidade** por um editor (`OpportunityEditor`, Modal) — escolhe o paciente ou **cadastra na hora** (reusa `PatientSelector`), com título, valor (máscara BRL), origem, responsável (da equipe `clinic_members`) e **tags** (chips). (2) **Arrastar card** entre colunas (drag-and-drop HTML5 nativo, zero dependência nova) — move pela RPC `move_opportunity` auditada, igual ao `<select>` que segue como alternativa. (3) **Filtros no cliente** (instantâneos): busca por paciente, responsável, origem e tag. (4) **Fechar como Ganho/Perdido** (com motivo) — sai do board de abertas. Criar/editar/fechar não tocam caixa/DRE/metas (oportunidade é pré-venda); estágio só muda pela RPC auditada. `src/components/OpportunityEditor.jsx`, `src/lib/opportunityActions.js`, `OpportunityPipeline.jsx`. Sem SQL novo (usa colunas já existentes). Design em `docs/superpowers/specs/2026-10-11-pipeline-crud-dnd-design.md`. Testes: `tests/e2e/pipeline-crud.spec.js`.

## [Unreleased] - 2026-10-11 (37)
### Added
- **IA sugere avanço de estágio** (CRM, Fase 2 — sub-projeto 4, **sugere e confirma**): conforme chegam mensagens no WhatsApp, a IA lê a conversa e **sugere** mover a oportunidade para o estágio certo — nunca move sozinha. O aviso aparece no **card do pipeline** e na **conversa do inbox** (🤖 estágio proposto + motivo + % de confiança) com **✓ Mover** / **✗ Ignorar**. Confirmar passa pelo `move_opportunity` já existente (auditado em `opportunity_stage_history`); descartar só dispensa. **Sem nova função serverless** (roda dentro do webhook do `api/whatsapp.js`, reusa `OPENAI_API_KEY`). Controle de custo: **pré-filtro grátis** por palavra-chave + **cooldown** por oportunidade + modelo barato — a IA só é chamada quando a mensagem sinaliza avanço. Guardrails: **forward-only**, limiar de confiança (`AI_SUGGEST_MIN_CONFIDENCE`, default 0.70), e à prova de falha (IA nunca derruba o recebimento). Lógica pura testada em `api/_lib/stageSuggest.js` (+ `stageSuggestClient.js`), ações compartilhadas em `src/lib/opportunitySuggestion.js`, UI em `OpportunityPipeline.jsx`/`WhatsAppInbox.jsx`. SQL em `supabase/whatsapp_ai_suggest.sql`; design em `docs/superpowers/specs/2026-10-11-whatsapp-ai-suggest-design.md`. Testes: `tests/unit/stageSuggest.spec.js`. Env opcionais: `OPENAI_SUGGEST_MODEL`, `AI_SUGGEST_MIN_CONFIDENCE`, `AI_SUGGEST_COOLDOWN_MIN`.

## [Unreleased] - 2026-10-10 (36)
### Added
- **Lead automático do WhatsApp** (Fase 2): quando um número **novo** manda mensagem, a clínica ganha um **lead no pipeline automaticamente** — o webhook cria o contato (paciente) + a oportunidade no novo estágio **"Primeiro Contato"**, usando o nome do contato do WhatsApp. Via RPC atômica e idempotente `ensure_whatsapp_lead`. Resolve de vez o "lead novo que chamava no zap e sumia": agora ele entra no funil sozinho. Novo estágio inicial `primeiro_contato` no pipeline. SQL em `supabase/whatsapp_lead_autocreate.sql`. (O avanço automático de estágio por interpretação das mensagens vem no motor de automação — sub-projeto 4.)

## [Unreleased] - 2026-10-10 (35)
### Added
- **Inbox central de WhatsApp** (Fase 2, 3b): nova tela em **Pacientes → WhatsApp** (`WhatsAppInbox`) com todas as conversas da clínica numa lista (estilo Chatwoot/Kommo) — nome do paciente ou número cru, prévia, horário, selo do número, e **conversas NÃO atribuídas** (lead novo que chamou no zap e antes sumia) destacadas com ⚠. Abrir uma conversa mostra o thread e permite responder escolhendo por qual número sair — inclusive responder a um lead ainda não cadastrado. Filtro por número. Visível a todos os perfis. `src/components/WhatsAppInbox.jsx`, nav/rota em `FinanceWorkspace.jsx`, ícone em `NavIcon.jsx`, acesso em `UserRoleContext.jsx`. Teste: `tests/e2e/whatsapp-inbox.spec.js`.

## [Unreleased] - 2026-10-10 (34)
### Added
- WhatsApp **multi-número** (Fase 2, 3a): suporte aos 3 números de WhatsApp Business da clínica. Tabela `whatsapp_numbers` (credenciais Z-API **por número**, lidas só no servidor — `instance_url`/`api_token` revogados do frontend), coluna `whatsapp_number_id` em `whatsapp_messages`. O endpoint `api/whatsapp.js` roteia o webhook **por número** (`?number=<id>&token=<secret>`) e envia pelo número escolhido (credenciais lidas da tabela via service role). Nova tela admin em **Configurações → WhatsApp** (`WhatsAppNumbers`) para cadastrar números + credenciais e copiar a URL de webhook de cada um. A aba WhatsApp do paciente agora escolhe por qual número enviar. SQL em `supabase/whatsapp_numbers_schema.sql`; design em `docs/superpowers/specs/2026-10-10-whatsapp-inbox-multinumero-design.md`. (A inbox central vem no incremento 3b.)

## [Unreleased] - 2026-10-10 (33)
### Changed
- **Funil → Pipeline de Oportunidades** (CRM estilo Kommo, Fase 2): a tela em Pacientes → Funil agora mostra **oportunidades (negócios)**, não mais 1 estágio por paciente. Card rico (paciente, título, valor, origem, tags, "há X dias no estágio", atalho WhatsApp) e soma de valores por coluna. Mover de estágio é **atômico e auditável** via RPC `move_opportunity` (atualiza estágio + grava `opportunity_stage_history` numa transação, registrando quem/quando/manual-vs-automação). `src/components/OpportunityPipeline.jsx` (substitui `PatientFunnel.jsx`), `src/pages/FinanceWorkspace.jsx`. Testes: `tests/e2e/opportunity-pipeline.spec.js`.

### Added
- CRM — Oportunidades (Fase 2, fundação): modelo de dados — tabela `opportunities` (um contato pode ter várias), histórico de estágio **auditável** (`opportunity_stage_history`), `opportunity_id` em cirurgias/consultas, RLS por clínica (`data_owner_id()`) e migração do `funnel_stage` atual. SQL em `supabase/opportunities_schema.sql` + RPC em `supabase/opportunity_move_rpc.sql`; design em `docs/superpowers/specs/2026-10-10-crm-opportunities-design.md`.

## [Unreleased] - 2026-10-10 (32)
### Added
- WhatsApp no CRM (Fase 2): aba **WhatsApp** no cadastro do paciente (área Pacientes) com histórico da conversa e envio de mensagem (`src/components/WhatsAppChat.jsx`, integrado em `Patients.jsx`). Backend: endpoint consolidado `api/whatsapp.js` (`?action=message` envia, `?action=webhook` recebe), cliente Z-API (`api/_lib/whatsappClient.js`) e helpers puros testados (`api/_lib/whatsapp.js`: normalização de telefone, parse do webhook, matching estrito telefone→paciente). Tabela `whatsapp_messages` com RLS por `data_owner_id()` e índice único para **idempotência** do webhook (`supabase/whatsapp_schema.sql`). Fidedignidade coberta por testes (`tests/unit/whatsapp.spec.js` + `tests/e2e/whatsapp-chat.spec.js`): webhook não duplica, ignora eco/`fromMe`, nunca atribui ao paciente errado (ambíguo → não atribui), e a UI mostra o histórico/caixa de envio. Provider escolhido: Z-API. **Ativação depende de criar a conta Z-API, setar env vars na Vercel e rodar o SQL.**

## [Unreleased] - 2026-10-10 (31)
### Changed
- Perfil seguro: os endpoints `secure-profile/get` e `secure-profile/save` foram consolidados num único `api/secure-profile.js` (roteado por `?action=get|save`) e o helper movido para `api/_lib/secureProfile.js`. Comportamento idêntico; libera **1 função serverless** (de 12 para 11, no limite de 12 do plano Hobby da Vercel) para a integração de WhatsApp da Fase 2. `src/lib/secureProfileClient.js`, `api/google/calendar.js` e `api/_lib/googleCalendarApi.js` ajustados para o novo caminho.

## [Unreleased] - 2026-10-10 (30)
### Fixed
- Controle de acesso: o perfil **Concierge** (ex.: Jonas) não podia ser atribuído a um membro — o CHECK da coluna `role` em `clinic_members` só aceitava admin/gestão/equipe, então convidar ou alterar para Concierge pela aba Equipe falhava com violação de constraint. SQL em `supabase/clinic_members_concierge_role.sql` (rodar no SQL Editor); `supabase/access_control_schema.sql` também corrigido para novas instalações.

## [Unreleased] - 2026-10-10 (29)
### Changed
- **Navegação reorganizada em 6 áreas de domínio** (Fase 0 — esqueleto de arquitetura, spec seção 4): barra de áreas no topo (Início · Pacientes · Clínico · Financeiro · Automações & Integrações · Configurações) e a sidebar passa a mostrar só a sub-navegação da área ativa, em vez do menu plano "Operação/Gestão". Cada feature futura cai na área certa. O funil fica em Pacientes; cirurgias/consultas/produtos/lançamentos no Financeiro; assinatura/configurações em Configurações. Visibilidade de área por perfil (admin vê as 6; gestão sem Automações/Config; equipe/concierge só Início/Pacientes). Deep-links `/app/:page` preservados. `src/pages/FinanceWorkspace.jsx`, `src/components/NavIcon.jsx`.
- IA deixou de ser item de menu — o Copiloto (`CopilotWidget`) já é global em qualquer área.

### Added
- Áreas "em breve": Clínico e Automações & Integrações aparecem na barra com selo "em breve" e uma página placeholder, comunicando o roadmap (serão preenchidas nas Fases 2 e 4). `AreaComingSoon` em `FinanceWorkspace.jsx`.
- Teste e2e `tests/e2e/area-navigation.spec.js`: barra com as 6 áreas, troca de área troca a sub-nav, placeholder "em breve", deep-link abre na área certa, funil em Pacientes.

## [Unreleased] - 2026-10-10 (28)
### Added
- Funil de jornada do paciente (Fase 1): nova tela kanban em **Pacientes → Funil** com 5 estágios (consulta agendada → consultado → orçamento enviado → reserva paga → follow-up). Cada card mostra nome/telefone/data e tem um seletor para mover o paciente entre estágios (atualização otimista com rollback em caso de erro). Leitura/escrita respeitam o multi-tenant via `ownerId` (membro de clínica enxerga os pacientes do dono). Nova coluna `funnel_stage` em `patients` — SQL em `supabase/patient_funnel_schema.sql` (aditiva, default `consulta_agendada`, rodar no SQL Editor antes do deploy). Visível a todos os perfis (admin/gestão/concierge/equipe). Arquivos: `src/components/PatientFunnel.jsx`, `src/pages/FinanceWorkspace.jsx`, `src/context/UserRoleContext.jsx`, `src/components/NavIcon.jsx`.
- Teste e2e do funil (`tests/e2e/patient-funnel.spec.js`): cobre listagem de pacientes por estágio e a movimentação (PATCH + reflexo otimista), com o Supabase mockado.

### Fixed
- Workspace redirecionava para o Dashboard ao recarregar ou acessar por link direto qualquer página (ex.: `/app/funnel`, `/app/finance`) enquanto o perfil ainda carregava. O guard de rota agora espera o `UserRoleContext` resolver antes de decidir acesso, e o contexto mantém `loading=true` enquanto não há usuário (elimina a janela role=null/loading=false que disparava o redirect). `src/pages/FinanceWorkspace.jsx`, `src/context/UserRoleContext.jsx`.

### Changed
- `UserRoleContext` concede perfil admin automaticamente sob `VITE_E2E_BYPASS_AUTH` (espelha o bypass já existente no `AuthContext`), destravando os testes e2e de rotas protegidas.

## [Unreleased] - 2026-10-09 (27)
### Added
- Parcelamento real de cirurgias (cronograma com N parcelas). Nova opção "Parcelado (cronograma)" na configuração de pagamento abre um modal para gerar parcelas por frequência (mensal/quinzenal/semanal), data da 1ª parcela e número de parcelas, com valores e formas de pagamento editáveis por parcela. `Sales.jsx`.
### Changed
- Cirurgias agora refletem no caixa **por parcela e por data**: cada parcela paga entra no fluxo de caixa na sua data; parcelas em aberto aparecem em Contas a receber pelo vencimento; a DRE segue reconhecendo a receita total pela competência (data da cirurgia). Antes a cirurgia era tudo-ou-nada pelo status. Fluxo de parcelas (`consultationPaymentFlow`) generalizado para `paymentScheduleFlow` e aplicado a cirurgias. "Marcar recebido" avança parcela a parcela. `financialMetrics.js`, `Finance.jsx`.

## [Unreleased] - 2026-10-09 (26)
### Added
- Aviso de vencimento "em atraso" nos lançamentos: ao marcar uma receita/despesa como "a receber/a pagar" com vencimento anterior a hoje (ex: lançamento retroativo de setembro), aparece um alerta vermelho indicando que ficará em atraso/inadimplência até ser liquidado. `Finance.jsx`.

## [Unreleased] - 2026-10-09 (25)
### Fixed
- Receita extra agora tem situação **A receber / Já recebi** (antes entrava sempre no caixa no ato de salvar e nunca aparecia em Contas a receber). Quando "a receber": aparece em Contas a receber pelo vencimento, conta na DRE pela competência e só entra no caixa ao marcar como recebida. SQL em `supabase/extra_revenue_status_migration.sql` (coluna `status`).
### Changed
- Despesa passou a ter o mesmo controle explícito de situação (**Já paguei / A pagar**) em vez de adivinhar pelo vencimento. "A pagar" vai para Contas a pagar e só sai do caixa ao marcar como paga; na DRE conta pela competência. Botões Recebido/Pendente passam a funcionar também para receitas extras na aba "A receber". `Finance.jsx`, `financialMetrics.js`, `dataModel.js`, `financeStore.js`.

## [Unreleased] - 2026-10-09 (24)
### Added
- Campo "Origem" (texto livre com sugestões, igual ao Centro de custo) em nova receita e nova despesa. Permite marcar de onde vem o lançamento (ex: Indicação, Instagram, Convênio X). Aparece na coluna Origem das abas Entradas/Saídas e no filtro. Lançamentos automáticos (cirurgia, consulta, produto) seguem com a origem do sistema. SQL em `supabase/origin_label_migration.sql` (coluna `origin_label` em `extra_revenues` e `expenses`). `Finance.jsx`, `dataModel.js`, `financeStore.js`, `financialMetrics.js`.

## [Unreleased] - 2026-10-09 (23)
### Added
- Regime de competência explícito em toda a plataforma. Novos campos **data de competência** (quando o fato entra na DRE) e **data de vencimento** (quando a cobrança vence) em cirurgias, consultas, despesas, receitas extras, vendas e compras de produto. SQL em `supabase/competence_date_migration.sql` (colunas `competence_date`/`due_date` + backfill).
- Colunas **Competência** e **Vencimento** lado a lado nas tabelas de Contas a receber e Contas a pagar.
### Changed
- DRE agora é de fato por **competência**: despesas passam a entrar no mês de competência (antes entravam pelo vencimento). Receitas/custos de cirurgia, consulta, produtos e receitas extras também passam a reconhecer pelo mês de competência. O fluxo de caixa continua pelo regime de caixa (data de pagamento/recebimento) — os dois regimes agora são separados corretamente. `financialMetrics.js`, `dataModel.js`, `financeStore.js`, `Finance.jsx`, `Sales.jsx`, `Consultations.jsx`, `Products.jsx`, `UI.jsx`.

## [Unreleased] - 2026-10-09 (22)
### Added
- Botão "Editar" em todos os lançamentos das abas Entradas e Saídas do financeiro. Receitas extras e despesas abrem o modal completo já existente. Cirurgias e consultas abrem modal de edição financeira com todos os campos (valor, data, pagamento, custos cirúrgicos). Vendas e compras de produto também editáveis. Qualquer alteração reflete imediatamente nos números do financeiro. `Finance.jsx`, `UI.jsx`.

## [Unreleased] - 2026-10-09 (21)
### Changed
- Centro de custo agora é campo de texto livre com sugestões (creatable combobox). O usuário pode digitar um valor novo, salvar o registro e o valor aparece como sugestão nas próximas vezes. `UI.jsx` (prop `creatable` no FInput via `<datalist>`), `Finance.jsx` (memo `allCostCenters` agrega valores já usados).

## [Unreleased] - 2026-10-09 (20)
### Added
- Campo "Centro de custo" no modal de nova entrada e nova saída financeira. Opções: Cirurgia Plástica, Consultas, Marketing, Infraestrutura, Administrativo, RH, Outros. Campo persistido nas tabelas `extra_revenues` e `expenses` (coluna `cost_center`). `Finance.jsx`, `financeStore.js`, `dataModel.js`.

## [Unreleased] - 2026-10-09 (19)
### Fixed
- Membros da clínica agora conseguem salvar recorrências, cirurgias via modal de recorrência em Finance, selecionar e criar pacientes em Cirurgias e em Consultas: `Recurrences.jsx`, `Finance.jsx`, `Sales.jsx`, `Consultations.jsx` agora usam `ownerId || user.id` em todos os writes e no `PatientSelector`.

## [Unreleased] - 2026-10-09 (18)
### Fixed
- Membros da clínica (ex: Lunara/gestão) não conseguiam salvar pacientes nem cirurgias: `Patients.jsx` agora usa `ownerId` do contexto de role em vez de `user.id`, garantindo que inserts e queries usem o `user_id` do owner. `Patients.jsx`, `UserRoleContext.jsx`.
- Adicionado bloco SQL em `access_control_schema.sql` para atualizar a RLS de todas as tabelas financeiras e médicas (`surgeries`, `consultations`, `medical_records` e outras 11 tabelas) para usar `data_owner_id()` em vez de `auth.uid()`, permitindo que membros gravem dados no contexto do owner. `supabase/access_control_schema.sql`.

## [Unreleased] - 2026-10-09 (17)
### Added
- Botão "Remover" nas entradas financeiras: cirurgias e consultas voltam para pendente (saem do financeiro mas continuam cadastradas); receitas adicionais e vendas de produto são excluídas permanentemente. `Finance.jsx`.
- Botão "Remover" em compras de produto nas saídas (além de despesas, que já tinham). `Finance.jsx`.

## [Unreleased] - 2026-10-09 (16)
### Changed
- Perfil `equipe` agora tem acesso somente a: Consultas, Agenda, Produtos e Pacientes. Removidos Dashboard, Procedimentos e Cirurgias. `UserRoleContext.jsx`.
- Resumo Rápido (Caixa hoje / Lucro líq. mês) no sidebar agora é ocultado para perfis sem acesso ao módulo Financeiro (equipe e concierge). Somente Admin e Gestão veem. `FinanceWorkspace.jsx`.
- Redirect ao tentar acessar página bloqueada agora aponta para a primeira página acessível do perfil, e não sempre para `/app/dashboard` (evitava loop para equipe). `FinanceWorkspace.jsx`.

### Added
- Novo perfil `concierge` (Jonas): acesso a Procedimentos, Cirurgias, Consultas, Agenda, Produtos e Pacientes — pode cadastrar orçamentos sem ver financeiro. `UserRoleContext.jsx`, `Settings.jsx`.
- Opção "Concierge" no formulário de convite e no select de alteração de perfil da aba Equipe. `Settings.jsx`.

> **Ação necessária no Supabase:** alterar o role do Jonas de `equipe` para `concierge` diretamente na tabela `clinic_members`.

## [Unreleased] - 2026-10-09 (15)
### Fixed
- Trocar o procedimento no formulário de cirurgia agora atualiza o valor corretamente. Antes, o primeiro auto-fill impedia que mudanças subsequentes de procedimento afetassem o valor total. `Sales.jsx` linha 390.
- Membros da clínica (ex: Lunara) agora enxergam os dados do dono (Vitoria) em vez de ERP vazio. `UserRoleContext` expõe `ownerId` (UUID do dono da clínica); `FinanceWorkspace` usa `ownerId` para carregar e salvar dados; `importLegacyDataIfNeeded` aceita `ownerId` como segundo parâmetro.
- Carregamento de dados aguarda `ownerId` estar disponível antes de disparar (evita query com UUID errado).

### Added
- Coluna `ownerId` no `UserRoleContext`, buscada da tabela `clinics` tanto para owners quanto para membros.
- Controle de acesso por perfil (Admin / Gestão / Equipe): `canAccess()` agora protege tanto o sidebar quanto a rota direta — acesso não autorizado redireciona para `/app/dashboard`. Arquivo: `src/pages/FinanceWorkspace.jsx`.
- Opção "Administrador" adicionada ao formulário de convite e ao select de alteração de perfil na aba Equipe. Arquivo: `src/components/Settings.jsx`.

> **Requer SQL no Supabase** (atualizar RLS de todas as tabelas financeiras para aceitar membros via `data_owner_id()`):
> ```sql
> DO $$ DECLARE t text; tables text[] := ARRAY['procedures','products','surgeries','consultations','product_sales','product_purchases','extra_revenues','expenses','assets','liabilities','goals']; BEGIN FOREACH t IN ARRAY tables LOOP EXECUTE format('DROP POLICY IF EXISTS "%s own rows" ON public.%I', t, t); EXECUTE format('DROP POLICY IF EXISTS "clinic members access" ON public.%I', t); EXECUTE format('CREATE POLICY "clinic members access" ON public.%I USING (data_owner_id() = user_id) WITH CHECK (data_owner_id() = user_id)', t); END LOOP; END; $$;
> ```

## [Unreleased] - 2026-10-09 (12)
### Changed
- Sidebar "Conta ativa" agora exibe nome do usuário e nome da clínica (em vez de email). `UserRoleContext` passa a buscar e expor `clinicName`.
- Aba Equipe em Configurações: lista de membros exibe e-mail e cargo (em vez de UUID truncado). E-mail é salvo em `clinic_members.member_email` no convite.

### Added
- Coluna `member_email text` na tabela `clinic_members` (aplicar SQL abaixo antes de usar):
  ```sql
  ALTER TABLE public.clinic_members ADD COLUMN IF NOT EXISTS member_email text;
  ```

## [Unreleased] - 2026-10-09 (11)
### Added
- Tooltip interativo no gráfico de Relatórios: ao passar o mouse sobre qualquer ponto, exibe card flutuante com receita, despesa e lucro do período, mais variação percentual e margem de lucro.
### Changed
- Pontos do gráfico agora são sempre visíveis (círculos); aumentam ao hover. Linha vertical tracejada marca a coluna ativa.

## [Unreleased] - 2026-10-09 (10)
### Changed
- Tela de Procedimentos: cards menores (`minmax(220px,1fr)` em vez de 300px), fonte e espaçamentos reduzidos. Checklist e descrição removidos da visualização do card (continuam editáveis no modal).
### Added
- Campo de busca por nome na tela de Procedimentos, com mensagem de "nenhum resultado" quando não há match.

## [Unreleased] - 2026-10-08 (9)
### Added
- **Controle de acesso por perfil**: `UserRoleContext` detecta automaticamente se o usuário logado é dono de uma clínica (`admin`) ou membro convidado (`gestao` / `equipe`). Na primeira sessão, a clínica é criada automaticamente.
- `canAccess(sectionId)` filtra a navegação lateral e a busca rápida conforme o perfil: admins veem tudo; gestão veem finanças mas não billing/settings; equipe veem apenas dashboard, pacientes e agenda.
- **Aba Equipe em Configurações** (visível apenas para admins): convite de membros por e-mail (via RPC `get_user_id_by_email`), seleção de perfil por membro (gestão/equipe), botão de remoção.
- `supabase/access_control_schema.sql`: tabelas `clinics` e `clinic_members` com RLS, função `data_owner_id()` para multi-tenancy transparente, RPC `get_user_id_by_email`, política atualizada em `patients`.

## [Unreleased] - 2026-10-08 (8)
### Changed
- `FInput` com `type="number"` agora exibe e aceita valores no padrão brasileiro: vírgula como separador decimal e ponto como separador de milhar (ex: `1.234,56`). Ao clicar no campo, permite digitar normalmente com vírgula; ao sair do campo, o valor é formatado automaticamente. Teclado mobile mostra teclado numérico com decimal.

## [Unreleased] - 2026-10-08 (7)
### Fixed
- `Consultations.jsx`: `forecastPaymentDate` não é mais inicializado com `today()` ao abrir o formulário. Antes, toda consulta nova aparecia imediatamente em "A receber" com a data de hoje, mesmo sem data de recebimento prevista. Agora o campo começa vazio e a data de vencimento em "A receber" usa `item.date` como fallback.
- `financialMetrics.js`: receitas extras com data futura não contam mais em `cashBalance` ("Recebido no período") antes do recebimento efetivo. O filtro `onOrBefore(item.date, balanceDate)` foi adicionado ao cálculo de `entriesFinancial` para alinhar com a lógica já existente em `cumulativeEntries`.
- `Finance.jsx`: formulário de despesa agora suporta data futura. Ao informar uma data de vencimento posterior a hoje, a despesa é salva como `status: 'aberto'` (sem `paymentDate`) e aparece em "A pagar". Um aviso em amarelo é exibido no formulário. Antes, toda despesa era forçada como paga no dia do lançamento.

## [Unreleased] - 2026-10-08 (6)
### Fixed
- Ao recarregar a plataforma, o app sempre abria na aba Assinatura independente de onde o usuário estava. Causa: quando redirecionado para `/app/billing` pelo guard de acesso, esse caminho era salvo como última rota visitada e restaurado na próxima sessão. Solução: `/app/billing` não é mais persistido em `LAST_APP_PATH_KEY`, e `AppEntryRedirect` ignora valores salvos de `/app/billing`, caindo em `/app/dashboard`.

## [Unreleased] - 2026-10-08 (5)
### Changed
- `PatientForm` reescrito como formulário em etapas (stepper): pills de navegação no topo com as seções **Identificação → Contato → Endereço → Clínico → Anamnese → TCLE → Revisão**. Cada etapa exibe apenas os campos daquela seção; botões Anterior/Próximo navegam entre elas; botão "Salvar paciente" aparece somente na última etapa.
- Etapa final **Revisão** exibe um resumo somente-leitura de todos os dados preenchidos, agrupados por seção, antes de confirmar o cadastro.
- Campos de texto longo (HDA, medicamentos, observações, etc.) agora crescem automaticamente conforme o usuário digita — altura calculada via `scrollHeight` sem barra de rolagem visível.

## [Unreleased] - 2026-10-08 (4)
### Changed
- Drawer do paciente reestruturado com 5 abas: **Resumo**, **Dados**, **Anamnese**, **Prontuário**, **Financeiro**.
- Nova aba **Resumo**: card de info rápida (idade, queixa, alergias, medicamentos), indicadores (sessões, procedimentos, total financeiro), status do TCLE e linha do tempo unificada com sessões de prontuário, cirurgias e consultas ordenadas por data.
- **Dados** agora contém apenas identificação, contato e endereço; **Anamnese** virou aba própria com todos os campos clínicos em cards individuais.

## [Unreleased] - 2026-10-08 (3)
### Added
- Anamnese médica completa no cadastro de pacientes (`supabase/patients_anamnese_migration.sql`): HDA, doenças crônicas, alergias, medicamentos em uso, cirurgias anteriores, internações, tabagismo, etilismo, atividade física, antecedentes familiares e antecedentes ginecológicos.
- Referência corrigida de CFP (Psicologia) para padrão CFM/CRM (Medicina) no módulo Pacientes.

### Changed
- `Patients.jsx`: formulário expandido com seção Anamnese estruturada em subseções; `DadosTab` exibe cada campo com card individual por tópico.

## [Unreleased] - 2026-10-08 (2)
### Added
- Componente `PatientSelector` (`src/components/PatientSelector.jsx`): dropdown de pacientes cadastrados com botão "+ Novo" que abre mini-modal inline (nome, CPF, telefone) para criar e selecionar o paciente sem sair do formulário de cirurgia ou consulta.

### Changed
- `Sales.jsx` e `Consultations.jsx`: campo "Paciente" substituído pelo `PatientSelector` — permite selecionar paciente existente ou criar novo direto do formulário. Campo "Identificador interno" mantido para anotações livres. Validação ajustada para aceitar qualquer um dos dois.

## [Unreleased] - 2026-10-08
### Added
- Módulo **Pacientes**: cadastro clínico completo seguindo o padrão CFP Resolução 1/2009 (`src/components/Patients.jsx`). Lista com busca por nome e CPF, drawer lateral com três abas — Dados (identificação, contato, endereço, clínico, TCLE), Prontuário e Financeiro. Item "Pacientes" adicionado ao menu Operação em `FinanceWorkspace.jsx`.
- **Prontuário eletrônico** (`src/components/MedicalRecord.jsx`) vinculado ao módulo Pacientes. Registros de sessão com data, evolução (texto livre), procedimentos aplicados e próxima sessão. Arquivamento sem exclusão conforme exigência CFP; numeração de sessões por ordem cronológica.
- Schema SQL de pacientes, prontuário e documentos do paciente (`supabase/patients_schema.sql`), com RLS por `user_id`, política sem DELETE em `medical_records` (CFP), FKs retrocompatíveis `patient_id` em `surgeries` e `consultations`, e índices de performance.
- Ícone SVG `patients` no `NavIcon.jsx`.

### Changed
- `Sales.jsx`: seletor de paciente cadastrado preenchido automaticamente — ao selecionar, o campo "Paciente ou ID interno" é preenchido com o nome completo. Novo campo `patientId` persistido no registro.
- `Consultations.jsx`: mesmo seletor de paciente cadastrado com auto-preenchimento do nome. Novo campo `patientId` persistido.
- `financeStore.js`: mappers de `surgeries` e `consultations` agora incluem `patient_id` / `patientId` para vincular registros financeiros ao cadastro de pacientes.

### Fixed
- `Sales.jsx`: ao selecionar um procedimento, o campo "Valor total" agora é preenchido automaticamente com o preço base cadastrado, eliminando a necessidade de informar o valor manualmente a cada registro.

## [Unreleased] - 2026-10-05
### Added
- Especificação técnica do assistente financeiro com IA v2 (`docs/superpowers/specs/2026-10-05-ai-financial-assistant-v2-design.md`), cobrindo consultas server-side com autenticação e RLS, function calling, privacidade, fallback transparente, rate limit persistente, observabilidade, rollout e critérios de aceite.
- Assistente financeiro com ferramentas server-side para resumo, comparação de períodos, despesas, procedimentos, produtos, obrigações, metas e previsões (`api/_lib/financialAssistant.js`), usando os mesmos cálculos do dashboard e sem enviar nomes de pacientes. Inclui migração de cota diária e telemetria sem conteúdo financeiro (`supabase/ai_assistant_schema.sql`) e testes unitários de segurança e consistência (`tests/unit/financialAssistant.spec.js`).

### Changed
- O endpoint `/api/financial-assistant` agora exige JWT Supabase, consulta os dados com RLS, executa function calling com schemas estritos, limita o loop de ferramentas e retorna período/evidências da análise. O widget envia a sessão, evita duplicar a pergunta no histórico, permite limpar a conversa e identifica respostas baseadas em dados ou em modo limitado (`api/financial-assistant.js`, `src/lib/aiClient.js`, `src/components/CopilotWidget.jsx`).
- O cálculo financeiro puro foi extraído para `src/financialMetrics.js`; `src/useMetrics.js` permanece como wrapper React para manter compatibilidade com o restante da aplicação.
- Workspace vinculado ao projeto Vercel `fintech`; `.vercel` e `test-results` foram adicionados ao `.gitignore` para não versionar metadados de deploy nem artefatos de teste.

### Fixed
- Corrigido o rate limit não durável e contornável por chamadas anônimas do assistente. A cota agora é atômica e persistente por usuário no Supabase, e falhas técnicas deixam de parecer respostas normais da IA.
- Corrigida a restauração de navegação que podia abrir Configurações após recarregar ou reentrar na plataforma. A rota atual agora é persistida na sessão e entre sessões, a sessão ativa tem prioridade sobre valores antigos e a entrada autenticada restaura a última tela (`src/routes.jsx`, `src/pages/FinanceWorkspace.jsx`, `src/landing/LandingPage.jsx`, `tests/e2e/session-restore.spec.js`).
- Corrigido o assistente que permanecia em modo limitado porque o modelo configurado não era aceito pelo endpoint Responses. O backend agora usa `gpt-5.2` como padrão e remove espaços ou quebras de linha da variável `OPENAI_MODEL` (`api/financial-assistant.js`).

## [Unreleased] - 2026-10-03
### Added
- Confirmação ao fechar modais de formulário com dados preenchidos: ao clicar no ×, em "Cancelar" ou fora do modal, aparece "Descartar alterações?" com as opções "Continuar editando" e "Descartar". Sem alterações, o modal fecha direto; ao salvar, fecha sem perguntar. Implementado no componente `Modal` (`src/components/UI.jsx`), valendo para lançamentos, cirurgias, consultas, metas, produtos, procedimentos e recorrências.
- Integração com Google Agenda na tela Agenda: botão "Conectar Google Agenda", envio automático de consultas e cirurgias (de hoje em diante) como eventos com `Nome completo — Procedimento`, exibição dos eventos do Google no calendário (somente leitura) e atualização do registro quando o horário de um evento vinculado é alterado no Google. Novos campos opcionais "Horário" e "Duração" em consultas e cirurgias. Endpoint único `api/google/calendar.js`, tabelas `google_calendar_connections` e `google_calendar_event_links` e colunas `start_time`/`duration_minutes` (migração `supabase/google_calendar_schema.sql`, que deve ser aplicada antes do deploy). Testes unitários (`npm run test:unit`) e e2e em `tests/`.
- Página pública de Política de Privacidade em `/privacidade` (`src/pages/PrivacyPolicyPage.jsx`, rota em `src/routes.jsx`, entrada em `public/sitemap.xml`), com a seção de uso dos dados do Google Agenda e a declaração de Uso Limitado exigidas pelo Google para a tela de consentimento OAuth.
- Página pública de Termos de Serviço em `/termos` (`src/pages/TermsOfServicePage.jsx`, rota em `src/routes.jsx`, entrada em `public/sitemap.xml`). O layout das páginas legais foi extraído para `src/components/LegalPage.jsx`, usado também pela Política de Privacidade.
- Regra obrigatória de preencher o `CHANGELOG.md` em toda alteração (`SYSTEM_RULES.md`, `PROMPT_GUIDE.md`, `CLAUDE.md` e `AGENTS.md`).

### Fixed
- Plataforma recarregava tudo (skeleton, nova busca de dados e regravação) ao voltar para a aba do navegador, atrasando o uso e desmontando telas e modais abertos. Causa: o Supabase emite um novo objeto `user` ao retomar a aba e os efeitos de `FinanceWorkspace` e `BillingContext` dependiam da referência do objeto. Agora dependem apenas de `user.id`, e `AuthContext` mantém a mesma referência quando o usuário não mudou.
- Modais perdiam o que estava preenchido ao clicar fora deles (inclusive ao soltar o mouse fora ao selecionar texto de um campo). O fundo do modal agora só fecha quando não há dados digitados; com dados, pede confirmação de descarte.

## [Unreleased] - 2026-04-29
### Fixed
- Corrigido bug de troca de tema com delay: `applyTheme` era chamado em `useEffect` (assíncrono, pós-render), fazendo com que os componentes renderizassem com as cores antigas e a atualização visual só ocorresse num segundo render disparado por outro clique. Solução: `applyTheme` agora é chamado de forma síncrona dentro de `toggleTheme`/`setTheme` antes do `setMode`, garantindo que `C` já tenha os valores corretos no momento do re-render.


### Fixed
- Corrigido bug de contraste no modo dark onde texto e fundo ficavam com a mesma cor ao trocar de tema. Constantes de estilo de módulo (`thStyle`, `tdStyle`, `titleStyle`, `labelStyle`, `inputStyle`, `SERIES`, `SUMMARY_CARDS`, `iconButton`, `chipButton`, `kbdSmall`) em `FinancialTable.jsx`, `FinancialPeriodFilter.jsx`, `FinancialChart.jsx`, `Reports.jsx`, `Finance.jsx` e `FinanceWorkspace.jsx` capturavam valores do objeto `C` na carga do módulo e não atualizavam ao mudar o tema. Solução: movidas para dentro dos componentes (avaliadas em cada render) ou convertidas em funções getter.

---

## [1.0.0] - 2026-04-20
### Added
- Estrutura inicial de memória e governança do projeto com `PROJECT_MEMORY.md`, `SYSTEM_RULES.md` e `PROMPT_GUIDE.md`.
- Padronização de registro histórico com este arquivo `CHANGELOG.md`.

### Changed
- Definida convenção formal para registrar evolução por versão e categoria técnica.

### Fixed
- Não se aplica nesta versão inicial.

---

## Template para próximas versões

## [X.Y.Z] - YYYY-MM-DD
### Added
- ...

### Changed
- ...

### Fixed
- ...
