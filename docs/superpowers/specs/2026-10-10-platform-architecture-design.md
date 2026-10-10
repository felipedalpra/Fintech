# Arquitetura da Plataforma — Áreas, Integridade de Dados e Padrão de Specs

Data: 2026-10-10

Status: design aprovado em conversa (Felipe). É a base para atualizar as specs por feature. Nenhuma mudança de código foi feita por este documento.

Escopo: arquitetura de informação (organização das áreas), princípios de integridade de dados, benchmarks de referência por área, padrão de spec por feature e protocolo de colaboração entre os vibe coders e o agente. Não especifica a implementação de nenhuma feature isolada — cada feature tem a sua própria spec, que segue o padrão definido aqui.

---

## 1. Objetivo

A plataforma (SurgiMetrics) centraliza muita coisa de domínios diferentes: CRM, financeiro, clínico, automações e integrações. Hoje a navegação é uma sidebar plana de 15 itens; com as features das Fases 1–4, isso vira ~27 itens num nível só — confuso e misturando trabalhos de perfis diferentes.

Este documento define:
1. Como organizar a plataforma por **áreas de domínio**, com sub-navegação enxuta e visibilidade por perfil.
2. Como garantir que os **dados sejam fidedignos** — o ponto inegociável: uma mudança num lugar reflete corretamente em todos os lugares derivados.
3. Em que **produto de mercado** cada área se espelha e quais **repositórios** usar de referência/reuso.
4. Um **padrão único de spec por feature** e um **protocolo de colaboração**, para que vibe coders com pouca experiência consigam pedir e entregar trabalho de forma organizada.

## 2. Contexto que guia as decisões

- **Cliente:** Dra. Vitória Ribeiro (cirurgiã plástica) + equipe (Augusto, Lunara/gestão, Jonas/concierge, Sumary/secretária, Jessica). Ver tabela de perfis no `CLAUDE.md`.
- **Contrato (Zentri Tech):** 4 fases — Centralização, Comunicação/WhatsApp, Financeiro avançado, Prontuário. Permissões por perfil definidas pela Dra. Vitória. WhatsApp: todos usam, só admin monitora/configura.
- **Lunara (gestão):** pede ajustes pequenos e recorrentes no financeiro (ex.: os commits recentes — competência×vencimento×caixa, parcelamento de cirurgias, origem editável, aviso de vencimento). O design precisa absorver esse refinamento contínuo sem reescrever nada.
- **Estado atual:** CRM e financeiro estão quase completos; o que falta em grande parte são **integrações e automações**, mais os ajustes finos. A área clínica e o funil ainda são os maiores vazios.

## 3. Princípio organizador: áreas por domínio

Organizar por **área/domínio** (por quem usa e qual trabalho faz), não por tela solta. A navegação tem **dois níveis**: um seletor de **Área** no topo, e dentro de cada área só as seções dela.

Benefícios: nenhuma área passa de ~6–7 itens; dá para **mostrar/esconder áreas inteiras por perfil** (encaixa na tabela de permissões do contrato); cada domínio fica coeso e testável de forma isolada.

O **paciente é a espinha**: tudo pendura em três mundos — relacionamento, clínico e negócio — mais a sala de máquinas (automações/integrações/config).

## 4. Mapa de áreas

| # | Área | Sub-navegação | Quem usa |
|---|------|---------------|----------|
| 1 | **Início** | Dashboard por perfil, alertas, "ações de hoje" | Todos (visão filtrada) |
| 2 | **Pacientes (CRM & Jornada)** | Funil (kanban) · Pacientes (lista+cadastro) · WhatsApp (inbox) · Agenda · Orçamentos/valores | Todos |
| 3 | **Clínico (Prontuário)** | Prontuário · Anamnese · Pedido de exames · Receituário · Documentos & assinatura | Perfis clínicos |
| 4 | **Financeiro** | *Movimento* (Lançamentos·Fluxo·DRE·Balanço) · *Operação* (Cirurgias·Consultas·Produtos·Recorrências) · *Cobrança* (Boletos·Conciliação) · *Análise* (Impostos·Metas·Relatórios) | Admin / Gestão |
| 5 | **Automações & Integrações** | Automações (régua WhatsApp, funil, cobrança) · WhatsApp (monitoramento+config) · Google Agenda · Banco/boletos | Admin |
| 6 | **Configurações** | Clínica · Equipe & acessos · Assinatura · Perfil | Admin |

### Regras transversais (decididas com o cliente)

1. **Um dado, várias portas.** Cirurgia, consulta e paciente são o mesmo registro, abríveis do Financeiro, do paciente e da agenda — nunca duplicados. A tela de gestão principal de Cirurgias/Consultas/Produtos fica no Financeiro (é onde margem, custo e pagamento vivem), com atalho a partir do paciente e da agenda.
2. **Automações como camada.** A configuração das automações concentra-se na área "Automações & Integrações" (admin), mas cada automação aparece **referenciada no contexto** onde age (um atalho no Funil, na Cobrança, no WhatsApp).
3. **WhatsApp separado por função.** Inbox por paciente dentro de Pacientes (todos usam); monitoramento de todas as conversas + config ficam na área de admin. Espelha o contrato.
4. **Orçamento em Pacientes.** "Orçamento/valores do paciente" fica na área Pacientes — assim o Jonas (Equipe) faz o trabalho dele sem entrar no Financeiro completo.
5. **IA é global.** O assistente deixa de ser item de menu e vira um botão global (já existe como `CopilotWidget`), disponível em qualquer área, perguntando sobre o contexto atual.

### Permissões por área (mapeia a tabela do contrato)

| Área | Admin | Gestão | Equipe |
|------|-------|--------|--------|
| Início | ✅ | ✅ | ✅ (filtrado) |
| Pacientes (+ Orçamentos) | ✅ | ✅ | ✅ |
| Clínico | ✅ | configurável | ❌ |
| Financeiro | ✅ | ✅ | ❌ |
| Automações & Integrações | ✅ | ❌ | ❌ |
| Configurações | ✅ | ❌ | ❌ |

A visibilidade de área é a primeira camada do Controle de Acesso (Fase 1). A segunda camada é por ação dentro da área (ex.: Gestão vê Financeiro mas não configura clínica).

## 5. Integridade de dados (fidedignidade) — regra central

> Dado fidedigno é prioridade inegociável. Uma mudança num lugar tem que refletir **corretamente** em todos os lugares derivados. Um número errado no financeiro vale menos que número nenhum.

### 5.1 Modelo: fonte única + derivação determinística

- **Registros-fonte** são a única verdade: cirurgias, consultas, produtos, despesas, receitas extras, recorrências, metas, pacientes. Eles são escritos pelo usuário.
- **Tudo que é total, saldo, KPI, DRE, fluxo, balanço, progresso de meta e alerta é DERIVADO** desses registros, calculado em `src/financialMetrics.js` / `buildMetrics` — nunca armazenado em paralelo. Não existe "total salvo" que possa divergir da soma dos registros.
- **Normalização estável:** `src/dataModel.js` normaliza payloads (UUID estável, compat legado); `src/lib/financeStore.js` prioriza o relacional e cai para legado. Toda escrita passa por `normalizeData`.
- **Três datas, três visões** (regime separado — ver memória `project_competence_regime_oct2026`): competência → DRE; vencimento → contas a pagar/receber; caixa → fluxo. Nenhuma feature pode confundir as três.
- **RLS por `auth.uid()`** em todas as tabelas; nada cross-tenant. Membros de clínica usam `data_owner_id()`.

### 5.2 Mapa de propagação (o que muda onde)

Toda spec de feature que escreve um registro-fonte DEVE declarar a sua propagação. Exemplo (cirurgia):

```
Cirurgia (valor, custos, status pagamento, datas)
  → Fluxo de caixa (pela data de caixa / recebimento)
  → DRE (pela competência)
  → Contas a receber (pelo vencimento + status)
  → Financeiro do paciente (vínculo patient_id)
  → Metas (progresso) → Dashboard (KPIs, alertas)
  → Agenda (start_time) → Google Agenda (se vinculado)
  → Funil (estágio "reserva paga" quando pagamento registrado)
```

### 5.3 Checklist de fidedignidade (obrigatório antes de concluir qualquer feature)

1. **Soma bate?** Os totais derivados batem com a soma dos registros-fonte, em todos os períodos e filtros.
2. **Propagou?** Editar/excluir um registro-fonte atualiza corretamente todas as visões do mapa de propagação.
3. **As 3 datas?** Competência, vencimento e caixa estão corretas e não trocadas.
4. **Sem órfão:** nenhum valor fica preso numa visão após o registro mudar; `patient_id` nullable não quebra retrocompat.
5. **Estados de pagamento:** a receber/recebido/parcial refletem o caixa e as contas corretamente.
6. **Teste automatizado:** há asserção que cobre a consistência cross-módulo da mudança (não só a tela alterada). Preferir `npm run test:unit`; fluxo crítico, `npm run e2e`.
7. **Sem mock em fluxo real** (SYSTEM_RULES 4) e **consistência front/back** (SYSTEM_RULES 5).

Esta seção generaliza e endurece a regra existente do `PROJECT_MEMORY` ("toda feature financeira deve preservar integridade de totais").

## 6. Benchmarks e repositórios por área

Referências para tornar cada área mais fácil de usar e para acelerar as integrações. Repos são para **espelhar padrões** (e, quando a licença permitir, reusar) — não para adotar stack inteira por cima da atual.

### Financeiro → espelhar no Olist / Tiny ERP
- **O que copiar:** contas a pagar/receber com origem rastreável, fluxo de caixa com projeção futura, conciliação OFX assistida por IA (a "Lis" cruza lançamentos×recebimentos e aponta divergências), DRE, geração de boletos, margem por canal. Fonte: [ERP Olist](https://olist.com/sistema-erp/).
- **Repos:** [Akaunting](https://github.com/akaunting/akaunting) (UX de fluxo/despesas) · [ERPNext](https://github.com/frappe/erpnext) (completude contábil, referência de modelo) · [node-boleto (pagar.me)](https://github.com/pagarme/node-boleto) e [gerar-boletos](https://github.com/Romulosanttos/gerar-boletos) (boleto+PIX QR) · [ofx-data-extractor](https://www.npmjs.com/package/ofx-data-extractor) (parse de extrato OFX).

### Pacientes / CRM → espelhar na Kommo
- **O que copiar:** funil kanban com cards e etapas configuráveis, inbox unificada por lead com etiquetas e atribuição, Salesbot (automação no-code que avança etapas), templates de WhatsApp, notas internas com menção, link/QR de conversa. Fonte: [kommo.com](https://www.kommo.com/).
- **Repos:** [DeskcommCRM](https://github.com/melgarafael/DeskcommCRM) (open alternative to Kommo, WhatsApp+kanban+LGPD, multi-tenant) · [wacrm](https://github.com/ArnasDon/wacrm) (MIT, inbox+pipelines+automações no-code) · [Frappe CRM](https://github.com/frappe/crm) (kanban drag-and-drop) · [Chatwoot](https://github.com/chatwoot/chatwoot) (inbox omnichannel) · engine WhatsApp: [Evolution API](https://github.com/EvolutionAPI/evolution-api) (Baileys, não-oficial) · kanban UI: dnd-kit.

### Clínico → espelhar no Amigo + melhores práticas de estética
- **O que copiar:** fotos antes/depois padronizadas por região e data com comparação lado a lado (slider) e marcação de pontos; anamnese personalizável por procedimento com assinatura; histórico de anamnese/prescrição na mesma tela do atendimento; planos de tratamento e sessões; termo de uso de imagem (LGPD). Fontes: [GestãoDS](https://www.gestaods.com.br/qual-o-melhor-prontuario-para-cirurgiao-plastico/), [SinapSYS](https://www.sinapsysapp.com.br/estetica).
- **Repos (padrões, não adoção — já há prontuário):** [Medplum](https://github.com/medplum/medplum) (FHIR, modelagem clínica) · [OpenEMR](https://github.com/openemr/openemr) (padrões de evolução/adendo).

## 7. Padrão de spec por feature

Toda spec em `docs/superpowers/plans/` passa a seguir esta estrutura, para ficar legível e testável por qualquer editor:

1. **Goal** — uma frase: o que a feature entrega para a clínica.
2. **Contexto do cliente** — o que a Dra. Vitória/Lunara pediu e por quê (link para reunião/memória quando houver).
3. **Área e lugar na navegação** — a qual das 6 áreas pertence e onde fica.
4. **Benchmark e o que copiar** — o produto de referência e os repos aplicáveis.
5. **Fluxo ideal** — passo a passo do uso, do ponto de vista do usuário.
6. **Modelo de dados e propagação** — tabelas/campos tocados + o mapa de propagação (seção 5.2).
7. **Pontos de integração/automação** — onde entra WhatsApp, boleto, OFX, Google, assinatura.
8. **Permissões** — quais perfis acessam o quê.
9. **Mapa de arquivos** — arquivos a criar/editar.
10. **Tasks** — passos de implementação numerados.
11. **Checklist de fidedignidade** — a lista da seção 5.3 aplicada a esta feature.
12. **Testes e aceitação** — o que precisa passar; `CHANGELOG.md` obrigatório.

## 8. Protocolo de colaboração (vibe coders ↔ agente)

Para manter organizado com editores de pouca experiência:

**O que o editor humano traz ao agente (ao pedir uma feature/ajuste):**
- O pedido em uma frase + quem pediu (Dra. Vitória / Lunara / etc.).
- O comportamento atual (print/descrição) e o comportamento desejado.
- Qualquer contexto novo do cliente (mensagem, reunião).

**O que o agente traz de volta ao editor:**
- A spec no padrão da seção 7 (ou o trecho atualizado), com o **mapa de propagação** e o **checklist de fidedignidade** preenchidos.
- A lista de arquivos tocados e os testes a rodar.
- Riscos de regressão explícitos (SYSTEM_RULES 2) antes de implementar.

**Regras herdadas do projeto (não negociáveis):** não alterar `api/*`, `supabase/*`, auth ou billing sem direção explícita (SYSTEM_RULES 1); respeitar o limite de 12 funções serverless da Vercel; `CHANGELOG.md` no mesmo commit (SYSTEM_RULES 7); `PROJECT_MEMORY.md` como referência (SYSTEM_RULES 6).

## 9. Migração do Amigo (Fase 2)

Felipe passou a ter **acesso à conta do Amigo (login)**. A spec `2026-10-08-...migração` (a criar/atualizar) deve:
- Investigar o que o Amigo exporta (CSV/Excel/API) com o acesso disponível.
- Mapear os campos do Amigo → modelo do SurgiMetrics (paciente, anamnese, histórico) respeitando o escopo (histórico clínico antigo está fora, salvo acordo).
- Tratar a migração como processo idempotente e auditável, sem duplicar pacientes.

## 10. Plano de rollout das specs

1. **Esta spec** (arquitetura) = fundação; todas as outras a referenciam.
2. Atualizar as specs por feature **por área e por fase**, nesta ordem de prioridade (Fase 1 primeiro):
   - Fase 1: `patient-funnel`, `access-control`, `google-agenda` (+ CRM/cadastro, que está quase pronto).
   - Fase 2: `whatsapp-crm`, `automacoes-whatsapp`, `automacoes-funil`, migração Amigo.
   - Fase 3: `conciliacao-bancaria`, `emissao-boletos`.
   - Fase 4: `medical-record-timeline`, `anamnese-completa`, `pedido-exames-pdf`, `receituario-pdf`, `assinatura-digital`.
3. Cada atualização aplica o padrão da seção 7 e o checklist da seção 5.3, e cita o benchmark/repo da seção 6.
4. Começar por **uma spec modelo** (recomendado: `patient-funnel`), validar o padrão com Felipe, e então replicar para as demais.
