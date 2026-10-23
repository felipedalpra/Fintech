import { expect, test } from '@playwright/test'

const json = body => ({ status:200, contentType:'application/json', body:JSON.stringify(body) })

test('cria plano e sessão, preserva após recarregar e mostra autoria clínica', async ({ page }) => {
  const plans = []
  const versions = []
  const statuses = []
  const sessions = []
  const events = []
  const createPayloads = []

  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/rest/v1/**', route => route.fulfill(json([])))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill(json({ profile:{ doctor:{ fullName:'Dra. E2E', registrationId:'12345' } } })))
  await page.route('**/rest/v1/patients*', route => route.fulfill(json([{ id:'patient-plan', full_name:'Ana Plano', date_of_birth:'1990-01-01', active:true }])))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill(json(null)))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill(json(true)))
  await page.route('**/rest/v1/medical_records*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/medical_record_addenda*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/clinical_treatment_plans*', route => route.fulfill(json(plans)))
  await page.route('**/rest/v1/clinical_treatment_plan_versions*', route => route.fulfill(json(versions)))
  await page.route('**/rest/v1/clinical_treatment_plan_status_events*', route => route.fulfill(json(statuses)))
  await page.route('**/rest/v1/clinical_treatment_sessions*', route => route.fulfill(json(sessions)))
  await page.route('**/rest/v1/clinical_treatment_session_events*', route => route.fulfill(json(events)))
  await page.route('**/rest/v1/rpc/create_clinical_treatment_plan*', async route => {
    const body = await route.request().postDataJSON()
    createPayloads.push(body)
    plans.push({ id:'plan-1', user_id:'e2e-user-id', patient_id:'patient-plan', created_at:'2026-10-23T12:00:00Z' })
    versions.push({
      id:'version-1', plan_id:'plan-1', patient_id:'patient-plan', version_number:1,
      title:body.p_title, indication:body.p_indication, diagnostic_summary:body.p_diagnostic_summary,
      objectives:body.p_objectives, planned_treatment:body.p_planned_treatment, guidance:body.p_guidance,
      expected_start_on:body.p_expected_start_on, review_on:body.p_review_on,
      author_name:'Dra. E2E', author_registration:'12345', author_council:'CRM', recorded_at:'2026-10-23T12:00:00Z',
    })
    statuses.push({ id:'status-1', plan_id:'plan-1', status:'active', recorded_at:'2026-10-23T12:00:00Z' })
    sessions.push({ id:'session-1', plan_id:'plan-1', patient_id:'patient-plan', sequence_number:1, session_type:'return', title:body.p_sessions[0].title, instructions:body.p_sessions[0].instructions })
    events.push({ id:'event-1', session_id:'session-1', plan_id:'plan-1', status:'planned', recorded_at:'2026-10-23T12:00:00Z' })
    await route.fulfill(json('plan-1'))
  })

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Plano/ }).click()
  await page.getByRole('button', { name:'Plano e retorno' }).click()
  await expect(page.getByText('Nenhum plano registrado')).toBeVisible()
  await page.getByRole('button', { name:'+ Novo plano' }).click()
  await page.getByLabel('Título do plano *').fill('Acompanhamento pós-operatório')
  await page.getByLabel('Indicação clínica *').fill('Seguimento após procedimento')
  await page.getByLabel('Objetivos terapêuticos *').fill('Acompanhar cicatrização e recuperação')
  await page.getByLabel('Tratamento proposto *').fill('Retornos seriados e cuidados locais')
  await page.getByLabel('Orientações, riscos discutidos e decisão compartilhada *').fill('Paciente orientada sobre sinais de alerta e alternativas')
  await page.getByLabel('Tipo').selectOption('return')
  await page.getByLabel('Título da etapa').fill('Retorno de 7 dias')
  await page.getByRole('button', { name:'Registrar plano' }).click()

  await expect(page.getByRole('heading', { name:'Acompanhamento pós-operatório' })).toBeVisible()
  await expect(page.getByText('Retorno de 7 dias')).toBeVisible()
  await expect(page.getByText(/Dra\. E2E · CRM 12345/)).toBeVisible()
  expect(createPayloads).toHaveLength(1)
  expect(createPayloads[0].p_sessions[0]).toMatchObject({ session_type:'return', title:'Retorno de 7 dias' })

  await page.reload()
  await page.getByRole('button', { name:/Ana Plano/ }).click()
  await page.getByRole('button', { name:'Plano e retorno' }).click()
  await expect(page.getByRole('heading', { name:'Acompanhamento pós-operatório' })).toBeVisible()
  await expect(page.getByText('Retorno de 7 dias')).toBeVisible()
})
