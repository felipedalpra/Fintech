import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const sql = readFileSync(join(process.cwd(), 'supabase/clinic_admin_manages_team.sql'), 'utf8')

test('a checagem vive em security definer — policy em clinic_members não pode reentrar na RLS', () => {
  // Policy de clinic_members consultando clinic_members = recursão infinita no Postgres.
  // E `clinics` tem RLS própria (auth.uid() = owner_id): para um admin-membro uma subconsulta
  // direta devolveria VAZIO, e um guard que dá vazio em silêncio decide errado.
  for (const fn of ['clinic_admin_can_see_members', 'clinic_admin_can_manage_member']) {
    const start = sql.indexOf(`create or replace function public.${fn}`)
    expect(start).toBeGreaterThan(-1)
    // Só o corpo da função, não os comentários do arquivo.
    const body = sql.slice(start, sql.indexOf('$$', start))
    expect(body).toContain('security definer')
    expect(body).toContain('set search_path = public, pg_temp')
  }
  expect(sql).toContain('public.is_clinic_admin()')
})

test('a linha do dono é intocável para um admin que não é dono', () => {
  expect(sql).toContain('c.owner_id <> p_member_user_id')
  // A leitura NÃO exclui o dono: admin precisa ver a equipe inteira, só não pode alterá-la toda.
  const read = sql.slice(sql.indexOf('clinic_admin_can_see_members'), sql.indexOf('clinic_admin_can_manage_member'))
  expect(read).not.toContain('<> p_member_user_id')
})

test('escrita e leitura ficam presas ao escopo da clínica do usuário', () => {
  expect(sql.match(/c\.owner_id = public\.data_owner_id\(\)/g)).toHaveLength(2)
})

test('cada operação tem sua policy, e escrita usa o guard restrito', () => {
  expect(sql).toContain('for select to authenticated\n  using (public.clinic_admin_can_see_members(clinic_id))')
  for (const cmd of ['insert', 'update', 'delete']) {
    expect(sql).toContain(`"Clinic members admin ${cmd}" on public.clinic_members`)
  }
  expect(sql).toContain('with check (public.clinic_admin_can_manage_member(clinic_id, user_id))')
})

test('as funções ficam fechadas para anon e a migration é transacional', () => {
  expect(sql).toContain('revoke all on function public.clinic_admin_can_see_members(uuid) from public, anon;')
  expect(sql).toContain('revoke all on function public.clinic_admin_can_manage_member(uuid, uuid) from public, anon;')
  expect(sql).toContain('grant execute on function public.clinic_admin_can_see_members(uuid) to authenticated;')
  expect(sql).toContain('begin;')
  expect(sql).toContain('commit;')
  // Policies antigas (dono e "vejo a minha linha") não podem ser removidas: policies são OR.
  expect(sql).not.toMatch(/drop policy if exists "Clinic members admin" on/)
  expect(sql).not.toMatch(/drop policy if exists "Clinic members self" on/)
})
