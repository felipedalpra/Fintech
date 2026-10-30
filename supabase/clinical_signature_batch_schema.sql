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
