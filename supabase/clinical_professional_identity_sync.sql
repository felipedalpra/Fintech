-- Cada profissional passa a conseguir registrar a PROPRIA identidade clinica
-- num lugar que o servidor consiga ler. Aditiva e idempotente.
--
-- Motivo (bug em producao, 01/11/2026): o Dr. Augusto (Administrador, NAO dono
-- da clinica) preencheu nome e CRM em Configuracoes -> "Medico e clinica" e a
-- emissao de documento era recusada pelo banco com
--   Identidade profissional nao configurada.  (22023)
--
-- Configuracoes grava no PERFIL SEGURO, que e criptografado: o banco nao le.
-- A funcao `clinical_author_identity()` resolve o autor por outras duas vias:
--   1. clinics.clinical_professional_*     -- SO quando o usuario e o dono
--   2. clinic_members.professional_*       -- para membros com acesso clinico
--
-- O dono tinha ponte (a tela gravava em `clinics`). O membro NAO tinha: a
-- policy de clinic_members so permite SELECT da propria linha, entao ele nao
-- conseguia gravar a propria identidade de jeito nenhum. Nao era cadastro
-- faltando -- era um caminho inexistente.
--
-- Esta RPC fecha esse caminho com o minimo de permissao: grava SOMENTE as tres
-- colunas de identidade, SOMENTE na linha de quem chamou. Nao toca em `role`
-- nem em `clinical_access`, entao nao abre escalonamento de privilegio.

begin;

create or replace function public.sync_clinical_professional_identity(
  p_name text,
  p_registration text,
  p_council text default 'CRM'
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_now uuid := public.data_owner_id();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_registration text := nullif(btrim(coalesce(p_registration, '')), '');
  v_council text := coalesce(nullif(btrim(coalesce(p_council, '')), ''), 'CRM');
  touched integer := 0;
begin
  if auth.uid() is null or owner_now is null then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  -- Valor vazio NUNCA pode apagar uma identidade ja gravada: um documento
  -- medico sem identificacao do profissional nao pode ser emitido, e apagar em
  -- silencio transformaria isso num bloqueio sem causa aparente.
  if v_name is null or v_registration is null then
    raise exception 'Nome e registro profissional sao obrigatorios.' using errcode = '22023';
  end if;
  if length(v_name) > 200 or length(v_registration) > 60 or length(v_council) > 20 then
    raise exception 'Identidade profissional invalida.' using errcode = '22023';
  end if;

  -- Dono da clinica: a identidade vive no registro da clinica.
  update public.clinics
  set clinical_professional_name = v_name,
      clinical_professional_registration = v_registration,
      clinical_professional_council = v_council
  where owner_id = auth.uid()
    and owner_id = owner_now;
  get diagnostics touched = row_count;
  if touched > 0 then return true; end if;

  -- Membro: a identidade vive no proprio vinculo. `cm.user_id = auth.uid()`
  -- garante que ninguem grave a identidade de outra pessoa.
  update public.clinic_members cm
  set professional_name = v_name,
      professional_registration = v_registration,
      professional_council = v_council
  from public.clinics c
  where cm.clinic_id = c.id
    and cm.user_id = auth.uid()
    and c.owner_id = owner_now;
  get diagnostics touched = row_count;
  return touched > 0;
end
$$;

revoke all on function public.sync_clinical_professional_identity(text, text, text) from public, anon;
grant execute on function public.sync_clinical_professional_identity(text, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- Conferencia
-- ---------------------------------------------------------------------------
-- Esperado: 1 linha.
--   select p.proname, pg_get_function_identity_arguments(p.oid)
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'sync_clinical_professional_identity';
