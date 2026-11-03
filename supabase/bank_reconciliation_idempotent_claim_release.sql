-- Hotfix de producao: uma limpeza atrasada deve ser idempotente.
--
-- Clientes antigos podem repetir a liberacao depois que a linha ja foi
-- conciliada, virou lancamento ou foi liberada por outra tentativa. Isso nao e
-- falha de integridade: o token informado ja nao possui uma reserva para
-- liberar. A funcao retorna a quantidade solicitada, mas altera somente linhas
-- que ainda pertencem exatamente ao mesmo token e ao mesmo autor.
--
-- Esta migration nao apaga registros e nao relaxa os filtros de tenant,
-- autoria, token ou protecao de lancamentos existentes.

begin;

create or replace function public.release_bank_statement_line_claims(p_line_ids uuid[], p_claim_token uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_now uuid := public.data_owner_id();
  expected_count integer := 0;
begin
  if auth.uid() is null or owner_now is null or not public.bank_reconciliation_can_manage() then
    raise exception 'Acesso negado à conciliação bancária.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_line_ids, 1), 0) = 0 or p_claim_token is null then
    raise exception 'Reserva de criação inválida.' using errcode = '22023';
  end if;

  select count(distinct value)::integer into expected_count
  from unnest(p_line_ids) as selected(value);

  update public.bank_statement_lines l
  set review_status = 'pending', review_reason = null, review_claim_token = null,
      reviewed_by = auth.uid(), reviewed_at = timezone('utc', now())
  where l.user_id = owner_now and l.id = any(p_line_ids) and l.archived_at is null
    and l.review_status = 'processing' and l.review_claim_token = p_claim_token
    and l.reviewed_by = auth.uid()
    and not exists (
      select 1 from public.bank_reconciliations r
      where r.statement_line_id = l.id and r.user_id = owner_now and r.reversed_at is null
    )
    and not exists (
      select 1 from public.financial_entries e
      where e.user_id = owner_now and e.source_id = l.id and e.archived_at is null
    )
    and not exists (
      select 1 from public.extra_revenues er
      where er.user_id = owner_now and er.id = l.id
        and coalesce(to_jsonb(er)->>'archived_at', '') = ''
    )
    and not exists (
      select 1 from public.expenses ex
      where ex.user_id = owner_now and ex.id = l.id
        and coalesce(to_jsonb(ex)->>'archived_at', '') = ''
    );

  -- O pos-estado desejado e "este token nao possui mais estas reservas".
  -- Se a linha ja mudou, nao ha nada a desfazer e a repeticao e um sucesso.
  return expected_count;
end
$$;

revoke all on function public.release_bank_statement_line_claims(uuid[], uuid) from public, anon;
grant execute on function public.release_bank_statement_line_claims(uuid[], uuid) to authenticated;

commit;
