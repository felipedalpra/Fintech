import { expect, test } from '@playwright/test'

test('assina evolução imutável e corrige somente por adendo', async ({ page }) => {
  const records = []
  const addenda = []
  const auditActions = []

  await page.route('**/rest/v1/patients*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([{ id:'patient-1', full_name:'Ana Prontuário', date_of_birth:'1991-02-03', active:true, start_date:'2026-01-10' }]),
  }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', async route => {
    auditActions.push((await route.request().postDataJSON()).p_action)
    await route.fulfill({ status:200, contentType:'application/json', body:'true' })
  })
  await page.route('**/rest/v1/rpc/create_clinical_record*', async route => {
    const payload = await route.request().postDataJSON()
    expect(payload).not.toHaveProperty('p_author_name')
    records.unshift({
      id:'record-1',
      user_id:'e2e-user-id',
      patient_id:payload.p_patient_id,
      created_by:'e2e-user-id',
      session_date:payload.p_session_date,
      evolution_notes:payload.p_evolution_notes,
      procedures_applied:payload.p_procedures_applied,
      next_appointment_date:payload.p_next_appointment_date,
      professional_name:'Dra. Clínica E2E',
      author_name:'Dra. Clínica E2E',
      author_registration:'CRM-E2E 0001',
      author_council:'CRM',
      authorship_source:'authenticated_user',
      archived:false,
      recorded_at:'2026-10-16T12:00:00Z',
    })
    auditActions.push('create_record')
    await route.fulfill({ status:200, contentType:'application/json', body:'"record-1"' })
  })
  await page.route('**/rest/v1/rpc/create_medical_record_addendum*', async route => {
    const payload = await route.request().postDataJSON()
    expect(payload).not.toHaveProperty('p_author_name')
    addenda.push({
      id:'addendum-1',
      user_id:'e2e-user-id',
      record_id:payload.p_record_id,
      addendum_text:payload.p_addendum_text,
      author_name:'Dra. Clínica E2E',
      author_registration:'CRM-E2E 0001',
      author_council:'CRM',
      created_at:'2026-10-16T12:05:00Z',
    })
    auditActions.push('create_addendum')
    await route.fulfill({ status:200, contentType:'application/json', body:'"addendum-1"' })
  })
  await page.route('**/rest/v1/medical_records*', async route => {
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(records) })
  })
  await page.route('**/rest/v1/medical_record_addenda*', async route => {
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(addenda) })
  })

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Prontuário/ }).click()
  await expect(page.getByText('Nenhuma evolução registrada.')).toBeVisible()

  await page.getByRole('button', { name:'+ Nova evolução' }).click()
  await page.getByPlaceholder('Anamnese do atendimento, exame, hipóteses, conduta e evolução…').fill('Paciente estável, sem intercorrências.')
  await page.getByRole('button', { name:'Assinar evolução' }).click()

  await expect(page.getByText('Paciente estável, sem intercorrências.')).toBeVisible()
  await expect(page.getByRole('button', { name:'Editar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Excluir' })).toHaveCount(0)

  await page.getByRole('button', { name:'+ Adendo' }).click()
  await page.getByPlaceholder('Descreva a correção ou informação complementar…').fill('Complemento sem alterar a evolução original.')
  await page.getByRole('button', { name:'Registrar adendo' }).click()

  await expect(page.getByRole('heading', { name:'Adicionar adendo' })).toHaveCount(0)
  await expect(page.getByText('Complemento sem alterar a evolução original.')).toBeVisible()
  expect(auditActions).toEqual(expect.arrayContaining(['view_record', 'create_record', 'create_addendum']))
})
