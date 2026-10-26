import { expect, test } from '@playwright/test'

test('clínica cria modelo, publica TCLE e gera link opaco para o paciente', async ({ page }) => {
  const templates = []
  const consents = []
  const requests = []
  const templateCalls = []
  const consentCalls = []

  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ profile:{ doctor:{ fullName:'Dra. E2E', registrationId:'CRM-RS 1' } } }) }))
  await page.route('**/rest/v1/patients*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([{ id:'patient-intake', full_name:'Ana Formulário', date_of_birth:'1990-01-01', active:true }]) }))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({ status:200, contentType:'application/json', body:'null' }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill({ status:200, contentType:'application/json', body:'true' }))
  await page.route('**/rest/v1/medical_records*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/medical_record_addenda*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/clinical_intake_templates*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(templates) }))
  await page.route('**/rest/v1/clinical_consent_templates*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(consents) }))
  await page.route('**/rest/v1/clinical_intake_requests*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(requests) }))
  await page.route('**/rest/v1/clinical_intake_submissions*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/rpc/create_clinical_intake_template*', async route => {
    const body = await route.request().postDataJSON()
    templateCalls.push(body)
    const previous = templates.find(template => template.id === body.p_replaces_template_id)
    const created = { id:`template-e2e-${templates.length + 1}`, user_id:'e2e-user-id', family_id:previous?.family_id || 'family-template', title:body.p_title, description:body.p_description, definition:body.p_definition, version:previous ? previous.version + 1 : 1, replaces_template_id:previous?.id || null, created_at:'2026-10-21T12:00:00Z' }
    templates.unshift(created)
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(created.id) })
  })
  await page.route('**/rest/v1/rpc/create_clinical_consent_template*', async route => {
    const body = await route.request().postDataJSON()
    consentCalls.push(body)
    const previous = consents.find(consent => consent.id === body.p_replaces_consent_id)
    const created = { id:`11111111-1111-4111-8111-${String(consents.length + 1).padStart(12, '0')}`, user_id:'e2e-user-id', family_id:previous?.family_id || 'family-consent', title:body.p_title, content:body.p_content, consent_type:body.p_consent_type, required:body.p_required, version:previous ? previous.version + 1 : 1, replaces_consent_id:previous?.id || null, created_at:'2026-10-21T12:00:00Z' }
    consents.unshift(created)
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(created.id) })
  })
  await page.route('**/rest/v1/rpc/create_clinical_intake_request*', async route => {
    const body = await route.request().postDataJSON()
    requests.unshift({ id:'request-e2e', user_id:'e2e-user-id', patient_id:'patient-intake', status:'pending', template_snapshot:{ title:'Anamnese pré-consulta' }, created_at:'2026-10-21T12:00:00Z', expires_at:'2026-10-24T12:00:00Z' })
    expect(body.p_consent_ids).toEqual(['11111111-1111-4111-8111-000000000002'])
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([{ request_id:'request-e2e', access_token:'c'.repeat(64), expires_at:'2026-10-24T12:00:00Z' }]) })
  })

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Formulário/ }).click()
  await page.getByRole('navigation', { name:'Ficha clínica do paciente' }).getByRole('button', { name:'Pré-anamnese e termos', exact:true }).click()
  await expect(page.getByText('Crie o primeiro modelo para liberar o link ao paciente.')).toBeVisible()

  await page.getByRole('button', { name:'+ Modelo' }).click()
  await page.getByLabel('Nome do modelo').fill('Anamnese pré-consulta')
  await page.getByRole('button', { name:'Salvar modelo imutável' }).click()
  await expect(page.getByText('Gerar link para Ana Formulário')).toBeVisible()

  await page.getByRole('button', { name:'Nova versão' }).click()
  await expect(page.getByText('Criar nova versão da pré-anamnese')).toBeVisible()
  await page.getByLabel('Nome do modelo').fill('Anamnese pré-consulta revisada')
  await page.getByRole('button', { name:'Salvar modelo imutável' }).click()
  await expect(page.getByRole('option', { name:'Anamnese pré-consulta revisada · v2' })).toHaveCount(1)
  expect(templateCalls[1].p_replaces_template_id).toBe('template-e2e-1')

  await page.getByRole('button', { name:'+ Termo/TCLE' }).click()
  await page.getByLabel('Título do termo').fill('TCLE de avaliação')
  await page.getByLabel('Conteúdo integral').fill('Texto integral do consentimento para avaliação clínica e tratamento de dados.')
  await page.getByRole('button', { name:'Publicar versão imutável' }).click()
  await expect(page.getByRole('button', { name:'Nova versão' })).toHaveCount(2)

  await page.getByRole('button', { name:'Nova versão' }).last().click()
  await expect(page.getByText('Criar nova versão do termo')).toBeVisible()
  await page.getByLabel('Conteúdo integral').fill('Texto integral revisado do consentimento para avaliação clínica e tratamento de dados.')
  await page.getByRole('button', { name:'Publicar versão imutável' }).click()
  await expect(page.getByRole('button', { name:'Nova versão' })).toHaveCount(3)
  expect(consentCalls[1].p_replaces_consent_id).toBe('11111111-1111-4111-8111-000000000001')

  await page.getByRole('button', { name:'Gerar link seguro' }).click()
  await expect(page.getByText('Link criado — copie agora')).toBeVisible()
  await expect(page.locator('input[readonly]')).toHaveValue(`http://127.0.0.1:4173/anamnese/${'c'.repeat(64)}`)
})
