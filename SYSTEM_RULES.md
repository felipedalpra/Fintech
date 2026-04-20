# SYSTEM_RULES

## Regras fixas de desenvolvimento

1. **Não alterar backend sem instrução explícita**
- Qualquer mudança em `api/*`, SQL em `supabase/*`, autenticação, billing ou regras server-side só pode ocorrer com direcionamento direto.

2. **Não quebrar funcionalidades existentes**
- Toda alteração deve preservar o comportamento atual de rotas, persistência, autenticação e cálculos financeiros.
- Em caso de risco de regressão, interromper implementação e registrar impacto antes de avançar.

3. **Priorizar código simples e legível**
- Preferir soluções diretas, com baixo acoplamento e nomenclatura clara.
- Evitar abstrações prematuras e complexidade desnecessária.

4. **Não usar dados mockados em funcionalidades reais**
- Dados de produção/dev devem vir das fontes oficiais do sistema (Supabase/API).
- Mock só é aceitável em cenários isolados de teste explícito, sem impactar fluxo real.

5. **Manter consistência entre frontend e backend**
- Contratos de dados, nomes de campos, status e regras de negócio devem estar alinhados.
- Mudanças de payload ou schema exigem atualização coordenada e validação ponta a ponta.

6. **Respeitar sempre o `PROJECT_MEMORY.md`**
- Antes de implementar, revisar contexto, decisões e regras do projeto.
- Em caso de conflito, `PROJECT_MEMORY.md` é referência obrigatória junto destas regras.

## Critérios obrigatórios antes de concluir alterações
- Nenhuma rota principal deve regressar (`/`, `/login`, `/signup`, `/app/*`).
- Fluxos críticos (autenticação, persistência e financeiro) devem permanecer íntegros.
- Mudanças devem ser documentadas no `CHANGELOG.md` quando aplicável.
