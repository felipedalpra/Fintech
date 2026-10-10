# CHANGELOG

Este projeto segue o padrão de changelog por versão, com categorias fixas:
- `Added`: novas funcionalidades
- `Changed`: alterações em comportamentos existentes
- `Fixed`: correções de bugs

## [Unreleased] - 2026-10-10 (28)
### Added
- Funil de jornada do paciente (Fase 1): nova tela kanban em **Pacientes → Funil** com 5 estágios (consulta agendada → consultado → orçamento enviado → reserva paga → follow-up). Cada card mostra nome/telefone/data e tem um seletor para mover o paciente entre estágios (atualização otimista com rollback em caso de erro). Leitura/escrita respeitam o multi-tenant via `ownerId` (membro de clínica enxerga os pacientes do dono). Nova coluna `funnel_stage` em `patients` — SQL em `supabase/patient_funnel_schema.sql` (aditiva, default `consulta_agendada`, rodar no SQL Editor antes do deploy). Visível a todos os perfis (admin/gestão/concierge/equipe). Arquivos: `src/components/PatientFunnel.jsx`, `src/pages/FinanceWorkspace.jsx`, `src/context/UserRoleContext.jsx`, `src/components/NavIcon.jsx`.

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
