# Cidade/local estruturado na cirurgia e consulta + distinção correta na agenda

Data: 2026-11-13

## 1. Goal

Registrar Goiânia/Brasília (e hospital/sala) como campo próprio da cirurgia/consulta, para a agenda distinguir cidade e tipo de atendimento de forma confiável — sem depender de cor do Google Calendar, que hoje se perde na sincronização.

## 2. Contexto do cliente

Treinamento de 12/11/2026 (memória `project_training_gaps_nov2026`). Fala do Jonas: ele marca cirurgia de Goiânia e de Brasília no mesmo Google Calendar, diferenciando só pelo nome do evento; "quando puxou pro sistema ficou tudo amarelo" — a plataforma perde a distinção de cidade ao importar. Confirmado por busca no código (13/11/2026): não existe campo de cidade nem hospital/sala estruturado em `surgeries`/`consultations`, só texto livre solto em observações.

Felipe confirmou (13/11/2026): é o **mesmo** Google Calendar (não dois calendários separados), a distinção hoje é só pelo **título do evento**. Padrão de título já usado pela equipe: Goiânia = título contém `"Consultório Gyn"`; Brasília = título contém `"Consultório Bsb"`.

Esta spec é sobre o lado **SurgiMetrics → Google** (a plataforma já cria/atualiza eventos com `buildEventTitle`, `src/lib/googleCalendarPayload.js`). O lado **Google → SurgiMetrics** (importar eventos criados direto no Google, fora da plataforma) ainda depende da integração completa, hoje pendente de conexão (`docs/superpowers/plans/2026-10-08-google-agenda.md`, branch `feat/google-calendar-por-clinica` fora da main) — essa spec prepara o terreno (função de parsing do título) mas não promete resolver a importação de eventos externos enquanto a conexão não estiver ativa.

## 3. Área e lugar na navegação

Área **Pacientes (CRM & Jornada)** → Agenda, e **Financeiro** → Operação → Cirurgias/Consultas (onde cidade/local é lançado).

## 4. Benchmark e o que copiar

Google Calendar nativo — usar cor por categoria na visualização da própria Agenda do SurgiMetrics (`src/components/Calendar.jsx`), sem depender da cor do evento no Google (que é por calendário, não por evento, no plano atual do cliente).

## 5. Fluxo ideal

1. Ao lançar cirurgia ou consulta, o Jonas escolhe "Cidade": Goiânia ou Brasília (lista fixa, mas extensível se a clínica abrir outra unidade). Campo opcional "Local/hospital" para detalhe (ex.: nome do hospital, sala).
2. A Agenda do SurgiMetrics (`Calendar.jsx`) passa a colorir/filtrar por cidade de forma confiável, porque lê o campo estruturado — não depende mais de nenhuma cor do Google.
3. Quando a cirurgia/consulta é sincronizada para o Google (`buildEventTitle`), o título passa a nascer com o prefixo que a equipe já usa: `"Consultório Gyn — Paciente — Procedimento"` (Goiânia) ou `"Consultório Bsb — Paciente — Procedimento"` (Brasília), em vez de só `"Paciente — Procedimento"`. Assim o evento criado pela plataforma fica no mesmo padrão que o Jonas já usa quando cria direto no Google.
4. (Preparação, não ativada agora) Função pura `parseCityFromEventTitle(title)` fica pronta para, quando a importação de eventos externos existir, pré-classificar automaticamente um evento criado direto no Google como Goiânia/Brasília pelo título.

## 6. Modelo de dados e propagação

```sql
alter table public.surgeries
  add column if not exists city text check (city is null or city in ('goiania', 'brasilia'));
alter table public.surgeries
  add column if not exists location_detail text check (location_detail is null or length(location_detail) <= 160);
alter table public.consultations
  add column if not exists city text check (city is null or city in ('goiania', 'brasilia'));
alter table public.consultations
  add column if not exists location_detail text check (location_detail is null or length(location_detail) <= 160);
```

Migration: `supabase/surgery_consultation_city_schema.sql` (aditiva, `city` nasce nulo — nada quebra para registros antigos; a Agenda trata `city is null` como "cidade a definir", igual pede o R12 do levantamento, nunca classificando errado por default).

**Mapa de propagação:**

```
Cirurgia/Consulta.city + .location_detail (novo)
  → Cor/filtro na Agenda (Calendar.jsx) — fonte da verdade, não depende do Google
  → Título do evento ao sincronizar para o Google (buildEventTitle) — prefixo "Consultório Gyn"/"Consultório Bsb"
  ✕ NÃO afeta financeiro (receita, DRE, caixa) — campo só de localização/agenda
```

## 7. Pontos de integração/automação

- **Google Agenda:** ponto de integração direto em `buildEventTitle`/`buildSyncPayload`. Depende da integração estar conectada (pendência já registrada em `PROJECT_MEMORY.md`, item 6 de "Próximos passos") — sem conexão ativa, o campo cidade já funciona dentro do SurgiMetrics (Agenda interna), só o reflexo no Google fica parado até a conexão existir.
- **Importação de eventos externos:** fora de escopo nesta spec; só deixa a função de parsing pronta (`parseCityFromEventTitle`) para quando essa funcionalidade existir.

## 8. Permissões

Mesmo acesso de hoje para `sales`/`consultations`/`calendar` (Admin, Gestão, Equipe/Concierge).

## 9. Mapa de arquivos

- `supabase/surgery_consultation_city_schema.sql` — criar.
- `src/dataModel.js` — normalizar `city`/`locationDetail` em cirurgia e consulta.
- `src/components/Sales.jsx` e `src/components/Consultations.jsx` — campo "Cidade" (select) + "Local/hospital" (texto) no formulário.
- `src/components/CalendarFinancialFields.jsx` — mesmo campo para lançamento pela Agenda.
- `src/components/Calendar.jsx` — cor/filtro por `city` na visualização da Agenda.
- `src/lib/googleCalendarPayload.js` — `buildEventTitle` ganha o prefixo por cidade; nova função pura `parseCityFromEventTitle(title)` (sem uso ainda, documentada para o futuro).
- `CHANGELOG.md`.

## 10. Tasks

1. Criar e aplicar a migration.
2. Normalizar os campos em `src/dataModel.js`.
3. Adicionar "Cidade" + "Local/hospital" em `Sales.jsx`, `Consultations.jsx` e `CalendarFinancialFields.jsx`.
4. Adicionar cor/filtro por cidade em `Calendar.jsx` (sem depender de nenhum dado do Google).
5. Atualizar `buildEventTitle` para prefixar "Consultório Gyn"/"Consultório Bsb" quando `city` estiver preenchido; manter o título atual quando `city` for nulo (retrocompatível).
6. Escrever `parseCityFromEventTitle(title)` como função pura testável, sem integrá-la a nenhum fluxo de importação ainda (comentário explicando que é preparação).
7. Teste unitário: cirurgia com `city='goiania'` gera título `"Consultório Gyn — ..."`; sem `city`, título igual ao de hoje (sem regressão).
8. Atualizar `CHANGELOG.md`.

## 11. Checklist de fidedignidade

1. **Soma bate?** Não aplicável.
2. **Propagou?** Mudar a cidade de uma cirurgia atualiza a cor/filtro na Agenda e, se sincronizado, o título no Google na próxima sincronização.
3. **As 3 datas?** Não aplicável.
4. **Sem órfão:** registros antigos com `city` nulo continuam funcionando, aparecem como "cidade a definir" na Agenda, título do Google sem prefixo (igual hoje).
5. **Estados de pagamento:** não aplicável.
6. **Teste automatizado:** task 7.
7. Sem mock; a parte do Google só é testável de fato depois que a integração estiver conectada em produção (pendência já conhecida, não criada por esta spec).

## 12. Testes e aceitação

- `npm run test:unit` cobrindo `buildEventTitle` com e sem `city`, e `parseCityFromEventTitle`.
- Verificação manual na Agenda interna do SurgiMetrics: cirurgias de Goiânia e Brasília aparecem com cor/filtro distintos, sem depender do Google.
- Verificação do título do evento no Google só depois que a integração estiver conectada (fora do controle desta spec).
- `CHANGELOG.md` atualizado no mesmo commit.
