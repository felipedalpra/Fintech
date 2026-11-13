# Biblioteca de orçamento PDF no paciente e no CRM

Data: 2026-11-13

## 1. Goal

Permitir anexar o PDF de orçamento já existente (o que a clínica já usa hoje) direto no paciente/oportunidade, com histórico de versões, para o Jonas parar de depender do grupo de WhatsApp para achar a proposta de um paciente.

## 2. Contexto do cliente

Treinamento de 12/11/2026 com Jonas e Sumary (memória `project_training_gaps_nov2026`). Fala do Jonas na transcrição: hoje o orçamento é um PDF que ele só acha "puxando o grupo de WhatsApp" quando precisa fechar algo com um paciente dias depois. Não existe hoje nenhuma feature de anexar/versionar PDF de orçamento (confirmado por busca no código em 13/11/2026 — nenhuma ocorrência de "orçamento" ligada a upload/anexo). É R17 do levantamento, prioridade P0.

Fora de escopo nesta spec (R18, proposto para depois, não pedido agora): editor de orçamento estruturado dentro da plataforma. Aqui o orçamento continua sendo feito fora (Word/Canva/etc.) e só é anexado como PDF.

## 3. Área e lugar na navegação

Área **Pacientes (CRM & Jornada)**: dentro da ficha do paciente (aba "Financeiro" — reaproveitar a aba já existente, não criar aba nova) e no painel lateral da oportunidade no CRM. Mesmo registro, duas portas (regra transversal #1 da arquitetura).

## 4. Benchmark e o que copiar

Nenhum benchmark externo necessário — é um anexo versionado simples, mais próximo do padrão já usado em `clinical_assets` (upload reservado no banco → Storage → confirmação) do que de qualquer CRM de mercado.

## 5. Fluxo ideal

1. Jonas abre o paciente (ou a oportunidade no CRM) e vê a seção "Orçamentos".
2. Clica em "Anexar orçamento", escolhe o PDF já pronto no computador.
3. O sistema registra automaticamente a versão (1ª, 2ª, 3ª...) com data e quem anexou; versões antigas continuam visíveis e abríveis, nunca são sobrescritas.
4. Jonas pode baixar, visualizar (abrir em nova aba) e enviar por WhatsApp — o botão de WhatsApp abre a conversa do paciente com uma mensagem pronta e o link do PDF (mesmo padrão já usado para receitas simples hoje: "abre o WhatsApp com o documento"; não depende do envio de mídia pela API, que ainda não existe — ver `project_whatsapp_v2_oct2026`).
5. Dias depois, qualquer pessoa com acesso ao paciente acha a última proposta em poucos cliques, sem abrir WhatsApp.

## 6. Modelo de dados e propagação

Tabela nova (não reaproveitar `clinical_assets`, porque aquela é protegida por `has_clinical_access()` e o Jonas — perfil Equipe/Concierge — não tem acesso clínico, mas precisa acessar orçamento):

```sql
create table if not exists public.budget_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,      -- dono/clínica (data_owner_id)
  patient_id uuid not null references public.patients(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete set null,
  version integer not null,
  file_name text not null,
  bucket_id text not null default 'budget-documents' check (bucket_id = 'budget-documents'),
  object_path text not null unique,
  expected_mime_type text not null default 'application/pdf' check (expected_mime_type = 'application/pdf'),
  expected_file_size bigint not null check (expected_file_size between 1 and 10485760),
  observed_mime_type text,
  file_size bigint,
  client_sha256 text not null check (client_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'uploading' check (status in ('uploading', 'available', 'failed', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  archived_at timestamptz
);
```

Migration: `supabase/budget_documents_schema.sql`, seguindo o mesmo padrão de reserva-antes-do-upload de `clinical_assets_schema.sql` (RPC cria a linha `uploading` e o `object_path`, o navegador sobe pro Storage, outra RPC confirma tamanho/hash e marca `available`) — mas com RLS por `user_id = data_owner_id()` **sem** a checagem `has_clinical_access()`, para o time inteiro (Admin/Gestão/Equipe) poder usar, igual ao acesso que já existe para `sales`/`patients`/`funnel` em `src/lib/roleAccess.js`.

**Mapa de propagação:**

```
Orçamento PDF anexado (budget_documents, versão N)
  → Seção "Orçamentos" na aba Financeiro do paciente (Patients.jsx)
  → Painel lateral da oportunidade (mesmo patient_id)
  → (opcional, v2) Timeline da oportunidade (src/lib/timeline.js) como evento "Orçamento anexado"
  ✕ NÃO entra em: receita, DRE, fluxo, contas a receber, metas — é só anexo, não cria lançamento
```

Nenhum registro financeiro é criado a partir do anexo (orçamento ≠ venda fechada). Se depois a cirurgia é lançada, é o fluxo normal de `Sales.jsx`, sem vínculo automático com o PDF.

## 7. Pontos de integração/automação

- **WhatsApp:** botão "Enviar por WhatsApp" abre `wa.me`/WhatsApp Web com o número do paciente e um texto pronto contendo o link do PDF (URL assinada de curta duração, igual ao padrão de `clinical_assets`/receituário). Não usa a API de envio de mídia (ainda não implementada — `project_whatsapp_v2_oct2026`). O histórico mostra apenas "link preparado", nunca "enviado", seguindo a regra do R27 de não afirmar estado sem evidência.
- Nenhuma automação de funil depende disso nesta fase.

## 8. Permissões

Upload/visualização/download: Admin, Gestão, Equipe/Concierge (mesma lista de `sales`/`patients`/`funnel` em `roleAccess.js` — inclui o Jonas). Arquivar uma versão enviada por engano: Admin/Gestão apenas (não Equipe), para evitar que alguém "esconda" uma proposta por erro ou de propósito.

## 9. Mapa de arquivos

- `supabase/budget_documents_schema.sql` — criar (tabela, bucket `budget-documents` privado PDF-only ≤10MB, RLS, RPCs de upload/confirmação/arquivamento).
- `src/lib/budgetDocuments.js` — novo: funções puras de leitura/normalização (lista por paciente, próxima versão, URL assinada).
- `src/components/BudgetDocuments.jsx` — novo componente de seção "Orçamentos" (lista de versões, anexar, baixar, abrir, enviar por WhatsApp).
- `src/components/Patients.jsx` — plugar `BudgetDocuments` na aba Financeiro do paciente.
- `src/components/OpportunityEditor.jsx` (ou o painel lateral equivalente) — plugar `BudgetDocuments` filtrado pelo `patient_id` da oportunidade.
- `CHANGELOG.md` — entrada em `Added`.

## 10. Tasks

1. Criar e aplicar `budget_documents_schema.sql` (tabela + bucket + RLS + RPCs: `create_budget_document_upload`, `complete_budget_document_upload`, `set_budget_document_archived`) — Felipe aplica no Supabase.
2. Criar `src/lib/budgetDocuments.js` com a lógica pura (próxima versão = contagem atual + 1 por paciente, normalização de linha).
3. Criar `src/components/BudgetDocuments.jsx`: lista de versões (mais recente primeiro), botão anexar (upload direto ao Storage após reservar via RPC), baixar, abrir em nova aba, enviar por WhatsApp (abre conversa com link).
4. Integrar em `Patients.jsx` (aba Financeiro) e no painel da oportunidade no CRM.
5. Escrever teste unitário da lógica pura de versionamento e teste e2e do fluxo de anexar → ver no paciente → ver na oportunidade (mesmo patient_id).
6. Atualizar `CHANGELOG.md`.

## 11. Checklist de fidedignidade

1. **Soma bate?** Não aplicável — não há totais financeiros derivados deste dado.
2. **Propagou?** Anexar no paciente aparece na oportunidade (e vice-versa) sem duplicar linha, porque os dois leem a mesma tabela pelo mesmo `patient_id`.
3. **As 3 datas?** Não aplicável.
4. **Sem órfão:** versão antiga nunca é apagada nem sobrescrita; arquivar marca `archived_at` e preserva o arquivo original, igual ao padrão de `clinical_assets`.
5. **Estados de pagamento:** não aplicável.
6. **Teste automatizado:** cobertura da task 5.
7. Sem mock em fluxo real; upload real contra o Supabase Storage.

## 12. Testes e aceitação

- `npm run test:unit` e `npm run e2e` cobrindo o fluxo de anexar/listar/versionar.
- Verificação manual: anexar duas versões do mesmo orçamento para um paciente, confirmar que ambas aparecem (mais recente primeiro) tanto na ficha do paciente quanto na oportunidade do CRM, e que o botão de WhatsApp abre a conversa certa com o link.
- `CHANGELOG.md` atualizado no mesmo commit.
