# CHANGELOG

Este projeto segue o padrão de changelog por versão, com categorias fixas:
- `Added`: novas funcionalidades
- `Changed`: alterações em comportamentos existentes
- `Fixed`: correções de bugs

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
