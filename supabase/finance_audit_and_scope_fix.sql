-- finance_audit_and_scope_fix.sql
-- Rodar no SQL Editor do Supabase. Idempotente: pode rodar mais de uma vez.
--
-- Corrige dois defeitos encontrados na investigação do incidente de importação financeira
-- (lançamentos confirmados na tela que não chegaram ao banco):
--   1. data_owner_id() escolhia a clínica sem ordenação determinística.
--   2. audit_logs não tinha policy de INSERT, então NENHUM registro de auditoria era gravado.

-- ---------------------------------------------------------------------------
-- 1. data_owner_id(): escolha determinística da clínica
-- ---------------------------------------------------------------------------
-- Antes: `limit 1` sem `order by`. Para um usuário com mais de uma clínica (como dono ou como
-- membro), o Postgres podia devolver qualquer uma, e o cliente escolhia a MAIS ANTIGA — então
-- clinicId (cliente) e ownerId (esta função) podiam apontar para clínicas diferentes. O financeiro
-- gravaria no escopo de uma e a equipe/WhatsApp/clínico no de outra.
--
-- Agora: a mesma regra dos dois lados — sempre a mais antiga.
create or replace function public.data_owner_id()
returns uuid language sql stable security definer as $$
  select coalesce(
    (select owner_id
     from public.clinics
     where owner_id = auth.uid()
     order by created_at
     limit 1),
    (select c.owner_id
     from public.clinic_members cm
     join public.clinics c on c.id = cm.clinic_id
     where cm.user_id = auth.uid()
     order by cm.created_at
     limit 1)
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. audit_logs: policy de INSERT
-- ---------------------------------------------------------------------------
-- A tabela tinha RLS ligada e SOMENTE policy de SELECT, então todo insert era rejeitado. O cliente
-- classificava esse erro como "ignorável" (a mensagem do Postgres cita a própria tabela) e seguia
-- em silêncio — resultado: zero registros de auditoria, e nenhuma trilha para datar incidentes.
--
-- Regra: só é possível registrar uma ação que VOCÊ praticou (actor_id = auth.uid()) e dentro do
-- escopo da SUA clínica (user_id = dono dos dados). Nada de escrever auditoria por outro usuário.
drop policy if exists "Users write own audit logs" on public.audit_logs;
create policy "Users write own audit logs" on public.audit_logs
  for insert to authenticated
  with check (actor_id = auth.uid() and user_id = public.data_owner_id());

-- Conferir depois de rodar:
--   select action, count(*), max(created_at) from public.audit_logs
--    where created_at > now() - interval '1 day' group by action;
--   -- 'sync_finance_data' deve aparecer na primeira gravação do financeiro após o deploy.

-- ---------------------------------------------------------------------------
-- 3. PENDENTE — NÃO RODAR AINDA: unique (owner_id) em clinics
-- ---------------------------------------------------------------------------
-- A ausência dessa constraint é a brecha estrutural que permitiu uma conta acumular ~100 clínicas
-- (o cliente já foi corrigido para não criar mais duplicatas). Esta constraint FALHA enquanto
-- existirem duplicatas, então a limpeza vem primeiro.
--
-- Passo 1 — ver quais donos têm duplicata e quais clínicas têm vínculo pendurado:
--   select c.owner_id, c.id as clinic_id, c.created_at,
--          (select count(*) from public.clinic_members m where m.clinic_id = c.id) as membros
--     from public.clinics c
--    where c.owner_id in (select owner_id from public.clinics group by owner_id having count(*) > 1)
--    order by c.owner_id, c.created_at;
--
-- Passo 2 — só depois de consolidar/remover as vazias, aplicar:
--   create unique index if not exists clinics_owner_id_key on public.clinics(owner_id);
