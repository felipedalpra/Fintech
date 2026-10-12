-- financial_accounts_schema.sql
-- Razão financeiro · Fase 8 — Contas (caixa, banco, cartão) (aditivo, idempotente).
-- Cada liquidação de parcela aponta para uma conta (financial_installments.financial_account_id,
-- já criado na Fase 1), permitindo saldo real por conta, transferências e conciliação com extrato.
-- Transferências entre contas geram 2 movimentos vinculados e NÃO entram na DRE (vêm numa fase de
-- autoridade com a tela de liquidação). Aqui é só o cadastro das contas.
-- Executar DEPOIS de access_control_schema.sql e financial_ledger_schema.sql. Rodar no SQL Editor.

create table if not exists public.financial_accounts (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  name                 text not null,
  account_type         text not null default 'cash'
                         check (account_type in ('cash','checking','savings','card','other')),
  opening_balance      numeric(12,2) not null default 0,
  opening_balance_date date,
  active               boolean not null default true,
  created_at           timestamptz not null default timezone('utc', now()),
  updated_at           timestamptz not null default timezone('utc', now()),
  archived_at          timestamptz
);

alter table public.financial_accounts enable row level security;
do $$ begin
  begin
    create policy "Financial accounts clinic access" on public.financial_accounts
      for all to authenticated
      using (user_id = public.data_owner_id())
      with check (user_id = public.data_owner_id());
  exception when duplicate_object then null; end;
end $$;
create index if not exists idx_financial_accounts_owner on public.financial_accounts(user_id) where archived_at is null;

-- FK da parcela para a conta. Só adiciona se financial_installments já existir (depende da Fase 1).
-- Assim este schema roda em qualquer ordem; quando a Fase 1 rodar, rode este de novo para criar a FK.
do $$ begin
  if to_regclass('public.financial_installments') is not null then
    begin
      alter table public.financial_installments
        add constraint fk_installment_account
        foreign key (financial_account_id) references public.financial_accounts(id) on delete set null;
    exception when duplicate_object then null; end;
  end if;
end $$;
