-- Assinatura SaaS (Zentri Tech cobrando a clínica) via Asaas, substituindo o Stripe.
-- Aditiva: não remove nem renomeia as colunas stripe_* antigas (ficam inertes, sem uso).
-- Não confundir com `billing_charges`/`billing_provider_connections`, onde a clínica
-- cobra seus próprios pacientes (Fase 3 de cobrança clínica).
-- Seguro para executar múltiplas vezes.

alter table public.billing_accounts
  add column if not exists provider text not null default 'none',
  add column if not exists asaas_customer_id text,
  add column if not exists asaas_subscription_id text,
  add column if not exists billing_contact_name text,
  add column if not exists billing_contact_document text,
  add column if not exists billing_contact_email text,
  add column if not exists billing_contact_phone text,
  add column if not exists coupon_code text,
  add column if not exists discount_type text check (discount_type in ('percentage','fixed')),
  add column if not exists discount_value numeric,
  add column if not exists next_due_date date,
  add column if not exists invoice_url text;

create unique index if not exists billing_accounts_asaas_subscription_id_key
  on public.billing_accounts (asaas_subscription_id)
  where asaas_subscription_id is not null;

create table if not exists public.saas_billing_coupons (
  code text primary key,
  discount_type text not null check (discount_type in ('percentage','fixed')),
  discount_value numeric not null check (discount_value > 0),
  applicable_plans text[],
  max_redemptions integer,
  redemptions integer not null default 0,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

-- RLS habilitado sem nenhuma policy: somente a service role (servidor) lê/grava cupons.
alter table public.saas_billing_coupons enable row level security;
