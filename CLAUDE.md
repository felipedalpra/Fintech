# Instruções para agentes e devs

Antes de qualquer alteração, leia `PROJECT_MEMORY.md` e `SYSTEM_RULES.md`.

**Regra obrigatória:** toda alteração no código deve ser registrada no `CHANGELOG.md` (categorias `Added`, `Changed`, `Fixed`) no mesmo commit. Sem entrada no changelog, a tarefa não está concluída.

---

## Contexto do projeto: SurgiMetrics

**Cliente:** Dra. Vitoria Ribeiro — cirurgiã plástica  
**Empresa responsável:** Zentri Tech  
**Objetivo:** Centralizar toda a operação da clínica (financeiro, pacientes, prontuário, equipe e comunicação) em um único sistema, substituindo vários softwares desconectados (financeiro separado, Amigo para anamnese/prontuário, outro para equipe).

### Equipe da clínica e níveis de acesso

| Perfil | Quem | Email |
|--------|------|-------|
| Administrador | Dra. Vitoria Ribeiro | vitoria.ribeiroo.cardoso@gmail.com |
| Administrador | Augusto | Draugustoribeiroplastica@gmail.com |
| Gestão | Lunara | luhbentom@gmail.com — **já tem conta ativa, usando a plataforma** |
| Equipe | Jonas (concierge) | jonassg1996@gmail.com |
| Equipe | Sumary (secretária) | sumaryoliveira72@gmail.com |
| Equipe | Jessica | jessycachriis26@gmail.com |

#### Permissões por módulo (definição da Dra. Vitoria — 2026-10-08)

| Módulo | Admin | Gestão | Equipe |
|--------|-------|--------|--------|
| Financeiro completo (DRE, fluxo de caixa, metas, totais mensais) | ✅ | ✅ | ❌ |
| Valores de paciente (cadastrar orçamento/procedimento) | ✅ | ✅ | ✅ Jonas |
| CRM — cadastro de pacientes | ✅ | ✅ | ✅ |
| Pedido de exames | ✅ | ✅ | ✅ |
| Funil de jornada / agendamentos | ✅ | ✅ | ✅ |
| WhatsApp — uso (enviar/receber mensagens) | ✅ | ✅ | ✅ |
| WhatsApp — monitoramento e configuração | ✅ | ❌ | ❌ |
| Configurações da clínica | ✅ | ❌ | ❌ |

> **Nota sobre Jonas:** ele pode cadastrar valores de procedimentos para pacientes (orçamento), mas não vê o fluxo de caixa, DRE nem totais financeiros do período.  
> **Nota sobre WhatsApp:** todos usam, mas apenas Dra. Vitoria e Augusto podem monitorar (ver todas as conversas de outros usuários) e configurar. A clínica usa **WhatsApp Business** — não WhatsApp pessoal.

> O controle de acesso por perfil ainda não foi implementado. É parte da Fase 1.

---

## Roadmap das 4 fases (proposta comercial)

### Fase 1 · Centralização (1–2 semanas) — EM PROGRESSO
- **CRM:** cadastro completo de pacientes integrado ao financeiro (já parcialmente implementado)
- **Funil de jornada:** quadro visual com estágios do paciente — consulta agendada → consultado → orçamento enviado → reserva paga → follow-up
- **Controle de acesso:** permissões por perfil (Administrador / Gestão / Equipe) — ainda não implementado
- **Google Agenda:** sincronização bidirecional — implementado na branch `feat/google-calendar`, pendente de conectar ao projeto Google correto

### Fase 2 · Dados e comunicação (1–2 semanas) — PENDENTE
- Migração dos cadastros do Amigo (condicionada à exportação do Amigo)
- WhatsApp integrado ao CRM (mesma caixa de entrada, histórico por paciente, por usuário)
- Automações de WhatsApp: lembrete de consulta/cirurgia, cobrança de pagamento pendente, link de anamnese, follow-up pós-consulta
- Automações de movimentação no funil (mudança de estágio automática por condição)

### Fase 3 · Financeiro avançado (2–3 semanas) — PENDENTE
- Conciliação bancária assistida por IA (lê extrato bancário, cruza com lançamentos)
- Emissão de boletos com confirmação automática de pagamento
- Cobrança automática via WhatsApp integrada ao vencimento real do financeiro

### Fase 4 · Prontuário e documentos clínicos (2–3 semanas) — PENDENTE
- Prontuário completo: linha do tempo, evoluções com adendo (sem apagar), anexos (exames, fotos, termos)
- Anamnese baseada na ficha atual do Amigo: texto livre, sim/não, múltipla escolha, peso/altura/IMC, alergias, medicações, cirurgias anteriores. Pode ser preenchida em consulta ou enviada por link no WhatsApp
- Pedido de exames: lista pré-cadastrada com kits (ex: kit pré-operatório), gera PDF com timbre da Dra.
- Receituário: medicamentos da clínica com posologia padrão, modelos prontos, PDF com timbre — sem receitas de controle especial (azul/amarela)
- Assinatura digital ICP-Brasil: fase 1 = upload do PDF assinado externamente; fase 2 = integração com BirdID/Vidaas

---

## O que está fora do escopo
- Receituário de controle especial (receita azul/amarela)
- Histórico clínico antigo do Amigo (anamneses e evoluções passadas)
- Certificação oficial de prontuário eletrônico
- Certificado digital ICP-Brasil (responsabilidade da clínica)
- Campos de anamnese além da ficha atual (orçado à parte)

---

## O que a clínica precisa fornecer
1. Ficha de anamnese atual usada no Amigo
2. Timbre: logo, endereço, contato e CRM da Dra. para documentos
3. Lista de exames e medicamentos mais usados, com kits e posologias padrão
4. Certificado digital ICP-Brasil da Dra. Vitoria

---

## Estado atual da plataforma (08/10/2026)

**Módulos implementados:**
- Financeiro: lançamentos (cirurgias/consultas), DRE, metas, indicadores, export Excel, conciliação manual
- Dashboard com KPIs, comparativo de períodos, alertas
- Pacientes: cadastro CFM, 5 abas no drawer (Resumo, Dados, Anamnese, Prontuário, Financeiro), formulário em etapas (stepper), prontuário eletrônico com archive-only
- PatientSelector integrado a cirurgias e consultas (auto-fill de procedimento + valor)
- Assistente financeiro com IA (OpenAI, function calling, RLS)
- Google Agenda: branch pronta, pendente de conectar

**Pendente da Fase 1:**
- Funil de jornada (kanban por estágio do paciente)
- Controle de acesso por perfil de usuário

**Stack:** React 18 + Vite 5 (frontend), Supabase Auth + Postgres + RLS (backend), Vercel (deploy), domínio `surgimetrics.com.br`

---

## Regras de desenvolvimento

- Prontuário: sem DELETE — apenas arquivamento (LGPD + CFM)
- Dados financeiros: RLS por `auth.uid() = user_id` em todas as tabelas
- Dark mode: constantes de estilo SEMPRE dentro dos componentes (nunca no nível de módulo)
- `patient_id` é FK nullable em `surgeries` e `consultations` para retrocompatibilidade
- App de medicina — referência sempre CFM/CRM, nunca CFP (que é Psicologia)

---

## ⚠️ Fidedignidade de dados (regra inegociável)

Dado errado é pior que dado nenhum. Antes de concluir QUALQUER alteração que toque um registro-fonte (cirurgia, consulta, produto, despesa, receita, recorrência, meta, paciente):

1. **Pense na propagação primeiro:** "o que muda aqui muda onde mais?" Mapeie o que é derivado (fluxo de caixa, DRE, balanço, contas a pagar/receber, financeiro do paciente, metas, dashboard, alertas, funil, agenda) ANTES de editar.
2. **Fonte única + derivação:** totais/KPIs/DRE/fluxo são SEMPRE derivados dos registros (`src/financialMetrics.js` / `buildMetrics`), nunca armazenados em paralelo. Nunca crie um "total salvo" que possa divergir da soma.
3. **Três datas, três visões:** competência → DRE; vencimento → contas a pagar/receber; caixa → fluxo. Nunca troque uma pela outra.
4. **Teste a consistência cross-módulo, não só a tela alterada:** a soma bate em todos os períodos/filtros? Editar/excluir propagou para todas as visões? Rode `npm run test:unit` (e `npm run e2e` em fluxo crítico) e, quando couber, adicione asserção que cobre a propagação.
5. Vale a regra existente do `PROJECT_MEMORY`: toda feature financeira preserva integridade de totais (receita, custo, margem, status de pagamento). Sem mock em fluxo real.

O checklist completo está na seção 5 de `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`.

## Arquitetura e padrão de specs (para vibe coders)

A organização da plataforma (áreas, navegação, permissões), os benchmarks por área (Financeiro→Olist/Tiny, CRM→Kommo, Clínico→Amigo), os repositórios de referência e o **padrão de spec por feature** estão em `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`. Leia essa spec antes de criar/editar specs em `docs/superpowers/plans/`.

**Protocolo de colaboração** (ao pedir/entregar uma feature):
- **Editor humano traz:** o pedido em 1 frase + quem pediu (Dra. Vitória/Lunara); comportamento atual vs. desejado; contexto novo do cliente.
- **Agente traz de volta:** a spec no padrão (seção 7 da spec de arquitetura) com o **mapa de propagação** e o **checklist de fidedignidade** preenchidos; arquivos tocados; testes a rodar; riscos de regressão explícitos antes de implementar.

## Fluxo de git (uma branch por funcionalidade)

- **Nunca trabalhar/commitar direto na `main`.** Uma branch por funcionalidade (`feat/<nome>`, `fix/<nome>`, `docs/<nome>`), criada da `main` atualizada. Ver regra 8 do `SYSTEM_RULES.md`.
- Sempre checar e comunicar o estado do git (o que está na `main`, o que já foi commitado, o que está no working tree) — os vibe coders têm dificuldade com isso; o agente mantém esse controle e guia.
- Push e merge **só quando pedido**. Ao terminar, reportar branch, commits e próximos passos (push/PR/merge).

## Agentes do projeto (`.claude/agents/`)

- **`code-reviewer`** (modelo: sonnet) — revisa o diff antes do merge: fidedignidade/propagação de dados, regressões, SYSTEM_RULES. Use ao concluir uma feature.
- **`platform-tester`** (modelo: haiku) — sobe o app local e testa os fluxos no Chrome, com screenshots e console; reporta observações (o veredito de fidedignidade fica com o revisor).
- **Custo:** tarefas mecânicas/repetitivas → modelo mais barato (haiku); tarefas que exigem conhecimento/rigor → modelo melhor (sonnet/opus). Sempre cuidar para não estourar o limite de tokens; não spawnar agente quando o trabalho inline resolve.
