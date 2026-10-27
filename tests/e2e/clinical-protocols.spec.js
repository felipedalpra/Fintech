import { expect, test } from '@playwright/test'

const json = body => ({ status:200, contentType:'application/json', body:JSON.stringify(body) })

test('cria protocolo compartilhado e o aplica como rascunho no plano', async ({ page }) => {
  const protocols = []
  const versions = []
  const statuses = []
  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/rest/v1/**', route => route.fulfill(json([])))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill(json({ profile:{ doctor:{ fullName:'Dra. E2E', registrationId:'12345' } } })))
  await page.route('**/rest/v1/patients*', route => route.fulfill(json([{ id:'patient-protocol', full_name:'Ana Protocolo', date_of_birth:'1990-01-01', active:true }])))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill(json(null)))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill(json(true)))
  await page.route('**/rest/v1/clinical_protocols*', route => route.fulfill(json(protocols)))
  await page.route('**/rest/v1/clinical_protocol_versions*', route => route.fulfill(json(versions)))
  await page.route('**/rest/v1/clinical_protocol_status_events*', route => route.fulfill(json(statuses)))
  await page.route('**/rest/v1/rpc/save_clinical_protocol*', async route => {
    const body = await route.request().postDataJSON()
    protocols.push({ id:'protocol-1', user_id:'e2e-user-id', created_at:'2026-10-23T12:00:00Z' })
    versions.push({
      id:'version-1', protocol_id:'protocol-1', user_id:'e2e-user-id', version_number:1,
      name:body.p_payload.name, procedure_name:body.p_payload.procedureName, description:body.p_payload.description,
      indication:body.p_payload.indication, objectives:body.p_payload.objectives,
      planned_treatment:body.p_payload.plannedTreatment, guidance:body.p_payload.guidance,
      anamnesis_prompts:body.p_payload.anamnesisPrompts, exam_kit:body.p_payload.examKit,
      medication_favorites:body.p_payload.medicationFavorites, photo_requirements:body.p_payload.photoRequirements,
      return_schedule:body.p_payload.returnSchedule, author_name:'Dra. E2E', author_council:'CRM', author_registration:'12345',
    })
    statuses.push({ id:'status-1', protocol_id:'protocol-1', status:'active', recorded_at:'2026-10-23T12:00:00Z' })
    await route.fulfill(json('protocol-1'))
  })
  await page.route('**/rest/v1/clinical_treatment_plans*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/clinical_treatment_plan_versions*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/clinical_treatment_plan_status_events*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/clinical_treatment_sessions*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/clinical_treatment_session_events*', route => route.fulfill(json([])))

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Protocolos/ }).click()
  await page.getByRole('button', { name:'+ Novo protocolo' }).click()
  await page.getByLabel('Nome do protocolo *').fill('Mamoplastia segura')
  await page.getByLabel('Procedimento *').fill('Mamoplastia')
  await page.getByLabel('Indicação clínica-base *').fill('Avaliação individual')
  await page.getByLabel('Objetivos *').fill('Planejar e acompanhar recuperação')
  await page.getByLabel('Tratamento proposto *').fill('Tratamento conforme avaliação')
  await page.getByLabel('Orientações, riscos e decisão compartilhada *').fill('Discutir riscos e alternativas')
  await page.getByLabel('Perguntas complementares da anamnese').fill('* Gestações anteriores')
  await page.getByLabel('Kit de exames').fill('Hemograma completo')
  await page.getByLabel('Etapas e retornos').fill('7 | Retorno de 7 dias | Avaliar cicatrização')
  await page.getByRole('button', { name:'Registrar versão' }).click()
  await expect(page.getByRole('heading', { name:'Mamoplastia segura' })).toBeVisible()
  await expect(page.getByText('1 perguntas')).toBeVisible()

  await page.getByRole('button', { name:'Visualizar' }).click()
  await expect(page.getByTestId('clinical-protocol-detail')).toContainText('Histórico preservado')
  await expect(page.getByTestId('clinical-protocol-detail')).toContainText('Hemograma completo')
  await page.getByRole('button', { name:'Duplicar' }).click()
  await expect(page.getByLabel('Nome do protocolo *')).toHaveValue('Cópia de Mamoplastia segura')
  await page.getByRole('button', { name:'Cancelar' }).click()

  await page.getByRole('button', { name:'Aplicar em paciente' }).click()
  const applyDialog = page.getByRole('dialog', { name:'Mamoplastia segura' })
  await applyDialog.getByRole('button', { name:/Ana Protocolo/ }).click()
  await applyDialog.getByRole('button', { name:/Plano e retorno/ }).click()
  await applyDialog.getByRole('button', { name:'Abrir rascunho' }).click()

  await expect(page.getByRole('heading', { name:'Ana Protocolo' })).toBeVisible()
  await expect(page.getByLabel('Título do plano *')).toHaveValue('Mamoplastia segura')
  await expect(page.getByLabel('Título da etapa')).toHaveValue('Retorno de 7 dias')
})
