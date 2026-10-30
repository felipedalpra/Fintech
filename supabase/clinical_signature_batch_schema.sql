-- Fase 4.4c: um envelope da BRy passa a carregar ate 10 documentos clinicos.
-- Executar depois de clinical_signature_bry_schema.sql.
-- Aditiva e idempotente: nao reescreve as migrations anteriores.
--
-- Motivo: a BRy cobra POR ENVELOPE (R$ 7,50 em 29/10/2026) e cada envelope
-- aceita ate 10 documentos. Um envelope por documento tornaria o custo por
-- pedido de exame ou receita igual ao de um envelope inteiro.
--
-- O que muda: varias tentativas passam a compartilhar `provider_request_id`
-- (o envelope), cada uma com seu proprio `provider_document_id`. Continua
-- valendo uma tentativa por documento, e um documento nunca aparece duas vezes
-- no mesmo envelope.

begin;

-- ---------------------------------------------------------------------------
-- 1. Unicidade por DOCUMENTO dentro do envelope, nao por envelope
-- ---------------------------------------------------------------------------
-- O indice anterior era unico em (user_id, provider, provider_request_id), o
-- que impedia duas tentativas de compartilharem um envelope.
drop index if exists public.uq_clinical_signature_provider_request;
create unique index uq_clinical_signature_provider_request
  on public.clinical_document_signatures(user_id, provider, provider_request_id, provider_document_id)
  where provider_request_id is not null;

-- Um envelope confirmado sem identificador de documento tornaria impossivel
-- saber de qual documento e o PDF assinado baixado. Falha fechada.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_document_signatures'::regclass
      and conname = 'clinical_document_signatures_envelope_document_pairing'
  ) then
    alter table public.clinical_document_signatures
      add constraint clinical_document_signatures_envelope_document_pairing
      check (provider_request_id is null or provider_document_id is not null) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Lote: a chave idempotente passa a ser compartilhada
-- ---------------------------------------------------------------------------
-- Todas as tentativas de um mesmo lote nascem com o mesmo `request_id`. A
-- unicidade existente (user_id, document_id, request_id) continua garantindo
-- que o mesmo documento nao entre duas vezes no mesmo lote, e reapresentar o
-- lote inteiro encontra as tentativas ja criadas em vez de duplicar o envelope.
comment on column public.clinical_document_signatures.request_id is
  'Chave idempotente da solicitacao. Compartilhada por todas as tentativas do mesmo lote/envelope.';
comment on column public.clinical_document_signatures.provider_request_id is
  'Envelope BRy. COMPARTILHADO pelas tentativas do mesmo lote; cada uma tem seu provider_document_id.';

-- Localizar rapidamente as tentativas de um lote, tanto pela chave idempotente
-- quanto pelo envelope devolvido pela BRy.
create index if not exists idx_clinical_signature_batch
  on public.clinical_document_signatures(user_id, request_id);

commit;

-- ---------------------------------------------------------------------------
-- 3. O mesmo DOCUMENTO CLINICO nao entra duas vezes no mesmo envelope
-- ---------------------------------------------------------------------------
-- O indice da secao 1 e por `provider_document_id`, que e o id da tentativa e
-- portanto unico por construcao: ele garante o vinculo, mas NAO impede que o
-- mesmo documento clinico apareca duas vezes no envelope (por exemplo, uma
-- tentativa terminal e outra nova, ou duas chaves idempotentes distintas).
-- Sem esta regra, dois PDFs assinados do mesmo documento conviveriam no mesmo
-- envelope e a escolha de qual vale seria ambigua.
begin;

create unique index if not exists uq_clinical_signature_envelope_document
  on public.clinical_document_signatures(user_id, provider, provider_request_id, document_id)
  where provider_request_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Claim do despacho: dois POSTs simultaneos nao criam dois envelopes
-- ---------------------------------------------------------------------------
-- Sem isto, duas abas (ou um retry de rede) com a mesma chave idempotente
-- chamam a criacao do envelope em paralelo. A segunda esbarra na imutabilidade
-- ao gravar outro envelope, mas o envelope dela ja foi criado e cobrado:
-- R$ 7,50 jogados fora e um envelope orfao em rascunho.
-- `sending` e o estado intermediario que so um dos concorrentes consegue tomar.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_document_signatures'::regclass
      and conname = 'clinical_document_signatures_dispatch_state_check'
  ) then
    alter table public.clinical_document_signatures
      drop constraint clinical_document_signatures_dispatch_state_check;
  end if;

  alter table public.clinical_document_signatures
    add constraint clinical_document_signatures_dispatch_state_check
    check (dispatch_state is null or dispatch_state in ('reserved', 'sending', 'sent', 'unknown')) not valid;
end $$;

comment on column public.clinical_document_signatures.dispatch_state is
  'reserved = criada sem chamar a BRy; sending = despacho em curso (claim contra corrida); sent = envelope confirmado; unknown = POST ambiguo, exige acao humana.';

commit;

-- ---------------------------------------------------------------------------
-- ATENCAO DE ORDEM
-- ---------------------------------------------------------------------------
-- `clinical_signature_readiness_schema.sql` recria o indice
-- `uq_clinical_signature_provider_request` na forma antiga (envelope unico por
-- tentativa). Se aquela migration for reexecutada DEPOIS desta, a assinatura em
-- lote volta a ser bloqueada. Reaplicando as migrations em sequencia, esta
-- precisa ser a ultima.
