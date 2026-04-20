# PROMPT_GUIDE

## Objetivo
Este guia define como o agente (Claude/Codex) deve operar neste repositório para garantir consistência técnica, previsibilidade e segurança de mudanças.

## Fluxo obrigatório de trabalho
1. **Ler `PROJECT_MEMORY.md` antes de qualquer ação**
- Entender contexto do produto, stack, decisões e pontos críticos do domínio financeiro.

2. **Seguir `SYSTEM_RULES.md` sem exceções**
- Regras fixas têm prioridade operacional durante análise, implementação e revisão.

3. **Explicar mudanças antes de implementar**
- Descrever claramente: o que será alterado, por quê, impacto esperado e riscos.
- Só então executar mudanças.

4. **Não tomar decisões sem contexto suficiente**
- Se faltar informação de regra de negócio, schema, contrato de API ou UX, parar e levantar o contexto necessário antes de codar.

5. **Priorizar UX e clareza de código**
- No frontend: foco em fluxo claro, previsível e sem fricção para o usuário final.
- No código: legibilidade, baixo acoplamento e manutenção simples.

## Princípios práticos para execução
- Preservar funcionalidades existentes como restrição principal.
- Evitar alterações paralelas em múltiplas camadas sem necessidade clara.
- Em mudanças de dados financeiros, validar impactos em cálculos, status e relatórios.
- Em mudanças visuais, manter consistência com branding e experiência atual.

## Checklist de resposta do agente
Antes de concluir uma tarefa, o agente deve confirmar:
- Leitura prévia de `PROJECT_MEMORY.md`.
- Conformidade com `SYSTEM_RULES.md`.
- Justificativa técnica objetiva das mudanças.
- Impacto esperado em usuário, dados e fluxos críticos.
- Registro no `CHANGELOG.md` quando aplicável.
