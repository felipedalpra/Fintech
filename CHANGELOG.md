# CHANGELOG

Este projeto segue o padrão de changelog por versão, com categorias fixas:
- `Added`: novas funcionalidades
- `Changed`: alterações em comportamentos existentes
- `Fixed`: correções de bugs

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
