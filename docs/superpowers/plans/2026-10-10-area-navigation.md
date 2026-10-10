# Fase 0 — Esqueleto de navegação por áreas — Implementation Plan

> Alinha a navegação à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md` (seção 4). Pré-requisito estrutural para as Fases 1–4: cada feature futura cai na área certa em vez de empilhar num nav plano.

**Goal:** Reorganizar a navegação do `FinanceWorkspace` nas **6 áreas de domínio** (Início · Pacientes · Clínico · Financeiro · Automações & Integrações · Configurações), com uma **barra de áreas no topo** e a sidebar mostrando apenas a sub-navegação da área ativa.

**Decisões (Felipe, 10/10):**
- Seletor de áreas = **barra horizontal no topo** (full-width). Sidebar passa a mostrar só a sub-nav da área ativa.
- Áreas ainda vazias (Clínico, Automações) aparecem **visíveis com "em breve"** (comunica o roadmap à Dra.).
- IA sai do menu (já existe `CopilotWidget` global). `ai` continua acessível por rota/`ROLE_ACCESS`, só não vira item de menu.

**Risco de fidedignidade:** baixíssimo — é apresentação/roteamento, não toca registro nem derivação. O cuidado é: (a) nenhuma página fica inalcançável; (b) deep-links `/app/:page` continuam funcionando; (c) cada role vê exatamente as áreas da tabela de permissões.

---

## Modelo de áreas (mapa dos ids atuais)

| Área (id) | Roles (barra) | Sub-nav (grupos → itens) |
|-----------|---------------|--------------------------|
| `inicio` | todos | Dashboard (`dashboard`) |
| `pacientes` | todos | CRM & Jornada → `funnel`, `patients`, `calendar` |
| `clinico` | admin, gestao | *(em breve — Fase 4)* |
| `financeiro` | admin, gestao | Movimento → `finance` · Operação → `sales`, `consultations`, `products`, `plans`, `recurrences` · Análise → `impostos`, `goals`, `reports` |
| `automacoes` | admin | *(em breve — Fase 2/3)* |
| `config` | admin | `settings`, `billing` |

> `equipe`/`concierge` só enxergam `inicio` e `pacientes` (as áreas restantes não têm itens acessíveis pra eles e são barradas na barra). `ai` fica fora do menu (Copiloto global). Cobrança (boletos/conciliação, Fase 3) entra em `financeiro` depois.

---

## Tasks

### Task 1 — Estruturas de dados e helpers
- [ ] Substituir `NAV_SECTIONS` por `AREAS` (array com `{ id, label, icon, roles, comingSoon?, sections:[{title,items:[...]}] }`), reusando os itens/ids/hints atuais.
- [ ] `areaForPage(page)` → id da área que contém a página (aliases de finance → `financeiro`).
- [ ] `canAccessArea(areaId)` → usa `roles` da área + `canAccess` dos itens (área visível se o role está em `roles` e há ≥1 item acessível, OU é `comingSoon` e o role está em `roles`).
- [ ] `allNavItems` (flatten de todas as áreas acessíveis) para a busca rápida e o `fallbackPage`.

### Task 2 — Barra de áreas (topo) + layout
- [ ] Reestruturar o layout externo para coluna: `<barra de áreas full-width>` acima da linha `<aside sub-nav> + <main>`.
- [ ] Barra: botões das 6 áreas (ícone + label), ativa destacada; `comingSoon` com selo "em breve". Clique numa área normal → `navigate` para a 1ª página acessível da área; clique em `comingSoon` → página placeholder.
- [ ] No mobile, a barra vira dropdown/scroll horizontal; manter o drawer da sidebar.

### Task 3 — Sidebar = sub-nav da área ativa
- [ ] `visibleSections` passa a ser as `sections` da área ativa, filtradas por `canAccess`, sem grupos vazios.
- [ ] Manter brand/conta/resumo/sign-out.

### Task 4 — Placeholder "Em breve"
- [ ] Componente `ComingSoon` (título da área + "disponível em breve" + o que virá). Renderizado quando a rota é de uma área `comingSoon` (nova rota `/app/<areaId>` ou página dedicada).

### Task 5 — Ajustar consumidores de nav
- [ ] `QuickSearchModal`: receber `allNavItems` (todas as áreas acessíveis) em vez de só a área ativa.
- [ ] `fallbackPage`: 1ª página acessível em `allNavItems`.
- [ ] `quickLinks`: derivar de `allNavItems`.

### Task 6 — Rotas
- [ ] `/app/:page` continua; adicionar resolução de `/app/<areaId>` → 1ª página da área (ou placeholder se comingSoon). Guard de acesso por área + página.

### Task 7 — Testes
- [ ] `npm run build` + `npm run test:unit`.
- [ ] e2e `tests/e2e/area-navigation.spec.js`: barra tem as 6 áreas; trocar de área troca a sub-nav; área "em breve" mostra placeholder; deep-link `/app/finance` abre na área Financeiro; funil segue acessível em Pacientes.
- [ ] Rodar e2e existentes (funil/session-restore) — sem regressão.

---

## Checklist de fidedignidade (desta mudança)
1. Toda página atual continua alcançável (nenhum id some do roteamento).
2. Deep-link/refresh em `/app/<page>` abre na área certa, sem redirect indevido.
3. Cada role vê exatamente as áreas da tabela (admin: 6; gestão: sem Automações/Config; equipe/concierge: só Início/Pacientes).
4. Busca rápida acha itens de todas as áreas acessíveis, não só da ativa.
5. Funil (feito) aparece em Pacientes; financeiro todo em Financeiro.

## Fora do escopo
- Quebrar `finance` em 4 itens (Lançamentos/Fluxo/DRE/Balanço) no menu — segue como 1 item com abas internas (refino posterior da área Financeiro).
- Popular Clínico/Automações (Fases 2/4).
- Atalhos cruzados "um dado, várias portas" (abrir cirurgia do paciente/agenda) — refino posterior.
