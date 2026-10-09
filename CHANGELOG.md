# CHANGELOG

Este projeto segue o padrão de changelog por versão, com categorias fixas:
- `Added`: novas funcionalidades
- `Changed`: alterações em comportamentos existentes
- `Fixed`: correções de bugs

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
