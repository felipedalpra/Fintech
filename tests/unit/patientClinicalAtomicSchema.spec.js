import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const sql = readFileSync(join(process.cwd(), 'supabase/patient_clinical_atomic_save.sql'), 'utf8')

test('salvamento atômico deriva a clínica da sessão e não aceita owner enviado pelo navegador', () => {
  expect(sql).toContain('security definer')
  expect(sql).toContain('owner_id := public.data_owner_id()')
  expect(sql).toContain('if auth.uid() is null')
  expect(sql).not.toMatch(/p_user_id|p_owner_id/)
})

test('cadastro e perfil clínico são gravados na mesma função com vínculo confirmado', () => {
  expect(sql).toContain('insert into public.patients')
  expect(sql).toContain('insert into public.patient_clinical_profiles')
  expect(sql).toContain('patient_id, user_id, chief_complaint')
  expect(sql).toContain('on conflict (patient_id) do update')
  expect(sql).toContain("'patient', to_jsonb(saved_patient)")
  expect(sql).toContain("'clinical_profile', case when p_clinical is null")
})

test('endpoint fica restrito à sessão autenticada e permite limpar campos clínicos', () => {
  expect(sql).toContain('chief_complaint = excluded.chief_complaint')
  expect(sql).toContain('current_medications = excluded.current_medications')
  expect(sql).toContain('revoke all on function public.save_patient_with_clinical_profile(uuid, jsonb, jsonb) from public, anon')
  expect(sql).toContain('grant execute on function public.save_patient_with_clinical_profile(uuid, jsonb, jsonb) to authenticated')
})
