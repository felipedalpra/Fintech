# Procedimento combinado/personalizado na cirurgia

Data: 2026-11-13

## 1. Goal

Deixar lançar uma cirurgia com um procedimento (ou combinação, ex.: "mama + braço") que não está pré-cadastrado no catálogo, sem travar o Jonas numa lista fechada.

## 2. Contexto do cliente

Treinamento de 12/11/2026 (memória `project_training_gaps_nov2026`). Fala literal do Jonas: "tem os mais clássicos... mas nas vezes que o doutor me passa com uma mama e braço, aí onde eu incluo? Eu não consigo incluir." Confirmado por leitura do código em 13/11/2026: `src/components/Sales.jsx:492` é um `<select>` fechado, alimentado só por `data.procedures` (tabela `procedures`, cadastro em `Plans.jsx`). Não existe hoje opção de texto livre. É R16 do levantamento, prioridade P0.

## 3. Área e lugar na navegação

Área **Financeiro** → Operação → Cirurgias (`Sales.jsx`) e Agenda (`CalendarFinancialFields.jsx`) — mesmo ponto onde o procedimento já é escolhido hoje.

## 4. Benchmark e o que copiar

Nenhum — ajuste pontual de formulário, não um padrão de mercado.

## 5. Fluxo ideal

1. No formulário de cirurgia, o dropdown de procedimento ganha uma última opção fixa: **"Outro / combinado (digitar)"**.
2. Ao escolher essa opção, aparece um campo de texto livre ("Nome do procedimento") onde o Jonas digita, por exemplo, "Mamoplastia + Braquioplastia".
3. O valor (`totalValue`) continua sendo digitado manualmente como já é hoje (o preço nunca veio automático de um texto livre, então não há nada a adaptar aí).
4. A cirurgia salva normalmente, exibindo o texto digitado em vez do nome do procedimento cadastrado, em todos os lugares onde o nome aparece (lista de cirurgias, card, Excel, financeiro do paciente).
5. Isso não cria um procedimento novo no catálogo (`procedures`) — é só um rótulo daquela cirurgia específica. Se o Jonas quiser, continua podendo cadastrar o combo como procedimento de verdade em Plans.jsx depois, separadamente.

## 6. Modelo de dados e propagação

```sql
alter table public.surgeries
  add column if not exists custom_procedure_name text check (custom_procedure_name is null or length(btrim(custom_procedure_name)) between 1 and 160);
alter table public.surgeries
  alter column procedure_id drop not null; -- já é nullable (on delete set null); confirmar que a constraint de app também aceita null quando custom_procedure_name está preenchido
```

Migration: `supabase/surgery_custom_procedure_schema.sql`.

**Regra de exclusividade:** uma cirurgia tem **ou** `procedure_id` (do catálogo) **ou** `custom_procedure_name` (texto livre) — nunca os dois vazios, nunca os dois preenchidos ao mesmo tempo. Validar no frontend (`Sales.jsx`/`CalendarFinancialFields.jsx`) antes de salvar.

**Mapa de propagação (só de exibição, não financeiro):**

```
Cirurgia.custom_procedure_name (novo)
  → Nome exibido no card/lista de Cirurgias (em vez de procedure.name)
  → Nome exibido na aba Financeiro do paciente
  → Nome exibido na exportação Excel/Central de Relatórios (onde hoje usa procedure?.name)
  ✕ NÃO cria linha nova em `procedures`
  ✕ NÃO afeta chartOfAccounts/categoria de receita — continua usando a conta padrão de cirurgia, já que o procedimento customizado não tem `chartAccountId` próprio
```

Nenhum cálculo financeiro muda — `totalValue` e os custos continuam exatamente como são hoje, só o nome exibido muda de fonte quando for procedimento customizado.

## 7. Pontos de integração/automação

Nenhum. `buildEventTitle` (Google Agenda, `src/lib/googleCalendarPayload.js:39`) já busca `procedures.find(...)?.name || 'Cirurgia'` — só precisa de um fallback extra para `record.customProcedureName` antes do `'Cirurgia'` genérico, senão o evento do Google perde o nome do procedimento combinado.

## 8. Permissões

Mesmo acesso de hoje para `sales` (Admin, Gestão, Equipe/Concierge).

## 9. Mapa de arquivos

- `supabase/surgery_custom_procedure_schema.sql` — criar.
- `src/dataModel.js` — normalizar `customProcedureName`.
- `src/components/Sales.jsx` — opção "Outro/combinado" no select + campo de texto condicional + exibição com fallback.
- `src/components/CalendarFinancialFields.jsx` — mesmo ajuste para cirurgia criada pela Agenda.
- `src/lib/googleCalendarPayload.js` — `buildEventTitle` ganha fallback para `record.customProcedureName`.
- `src/lib/reportCatalog.js` / `reportWorkbook.js` (Central de Relatórios) — onde exibe nome do procedimento, usar o mesmo fallback.
- `CHANGELOG.md`.

## 10. Tasks

1. Criar e aplicar a migration.
2. Normalizar o campo em `src/dataModel.js`.
3. Adicionar a opção "Outro/combinado" + campo de texto em `Sales.jsx`, com a regra de exclusividade (procedure_id XOR custom_procedure_name) validada antes de salvar.
4. Repetir em `CalendarFinancialFields.jsx`.
5. Ajustar `buildEventTitle` e os pontos de exportação Excel que leem `procedure?.name`.
6. Teste unitário: cirurgia com `customProcedureName` aparece corretamente na lista, no Excel e no título do evento do Google, sem criar registro em `procedures`.
7. Atualizar `CHANGELOG.md`.

## 11. Checklist de fidedignidade

1. **Soma bate?** Não aplicável — campo não financeiro.
2. **Propagou?** Nome customizado aparece em todos os lugares que hoje leem `procedure.name` (lista, paciente, Excel, Google).
3. **As 3 datas?** Não aplicável.
4. **Sem órfão:** cirurgias antigas continuam com `procedure_id` normal, campo novo nasce nulo.
5. **Estados de pagamento:** não aplicável.
6. **Teste automatizado:** task 6.
7. Sem mock; consistência front/back garantida pela regra de exclusividade validada nos dois formulários.

## 12. Testes e aceitação

- `npm run test:unit` cobrindo a regra de exclusividade e a exibição do nome customizado.
- Verificação manual: lançar "Mamoplastia + Braquioplastia" numa cirurgia e confirmar que aparece certo na lista, no financeiro do paciente e (se a Google Agenda estiver conectada) no título do evento.
- `CHANGELOG.md` atualizado no mesmo commit.
