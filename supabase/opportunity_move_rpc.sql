-- opportunity_move_rpc.sql
-- Movimentação atômica e auditável de oportunidade entre estágios.
-- Numa única transação: atualiza stage + stage_entered_at e grava o histórico.
-- Usada pelo pipeline (source='manual') e, futuramente, pelas automações (source='automacao').
-- Executar DEPOIS de opportunities_schema.sql. Rodar no Supabase SQL Editor.

create or replace function public.move_opportunity(
  opp_id uuid,
  new_stage text,
  move_source text default 'manual'
)
returns public.opportunities
language plpgsql
security definer
as $$
declare
  old_stage text;
  owner uuid;
  result public.opportunities;
begin
  select stage, user_id into old_stage, owner
  from public.opportunities where id = opp_id;

  if owner is null then
    raise exception 'Oportunidade não encontrada';
  end if;

  -- Só a clínica dona (o próprio ou um membro) pode mover.
  if owner <> public.data_owner_id() then
    raise exception 'Sem permissão para mover esta oportunidade';
  end if;

  if move_source not in ('manual', 'automacao') then
    move_source := 'manual';
  end if;

  update public.opportunities
    set stage = new_stage,
        stage_entered_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = opp_id
    returning * into result;

  insert into public.opportunity_stage_history (opportunity_id, user_id, from_stage, to_stage, moved_by, source)
  values (opp_id, owner, old_stage, new_stage, auth.uid(), move_source);

  return result;
end $$;
