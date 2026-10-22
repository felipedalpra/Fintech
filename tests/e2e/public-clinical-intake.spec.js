import { expect, test } from '@playwright/test'

test('paciente preenche formulário público e confirma termo sem criar prontuário', async ({ page }) => {
  const submissions = []
  let clinicalWriteCalled = false

  await page.route('**/rest/v1/rpc/get_public_clinical_intake*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({
      clinicName:'Clínica E2E',
      title:'Pré-anamnese cirúrgica',
      description:'Responda antes da consulta.',
      expiresAt:'2026-10-25T12:00:00Z',
      definition:{ fields:[
        { id:'motivo', label:'Qual o motivo da consulta?', type:'textarea', required:true, soap_field:'chief_complaint' },
        { id:'alergias', label:'Possui alergias?', type:'boolean', required:true, soap_field:'personal_history' },
      ] },
      consents:[{ id:'11111111-1111-4111-8111-111111111111', title:'TCLE de avaliação', content:'Texto integral do termo de consentimento para avaliação clínica.', type:'tcle', required:true }],
    }),
  }))
  await page.route('**/rest/v1/rpc/submit_public_clinical_intake*', async route => {
    submissions.push(await route.request().postDataJSON())
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify('submission-e2e') })
  })
  await page.route('**/rest/v1/rpc/create_clinical_anamnesis*', route => {
    clinicalWriteCalled = true
    return route.fulfill({ status:500, body:'unexpected' })
  })

  await page.goto(`/anamnese/${'a'.repeat(64)}`)
  await expect(page.getByRole('heading', { name:'Pré-anamnese cirúrgica' })).toBeVisible()
  await page.getByLabel('Qual o motivo da consulta? *').fill('Avaliação para procedimento')
  await page.getByLabel('Sim').check()
  await page.getByText('TCLE de avaliação').click()
  await page.getByText(/Li e aceito este termo obrigatório/).click()
  await page.getByText('Nome completo de quem está respondendo *').locator('..').getByRole('textbox').fill('Paciente E2E')
  await page.getByRole('button', { name:'Confirmar e enviar' }).click()

  await expect(page.getByText('Respostas enviadas')).toBeVisible()
  expect(submissions).toHaveLength(1)
  expect(submissions[0].p_answers).toEqual({ motivo:'Avaliação para procedimento', alergias:true })
  expect(submissions[0].p_accepted_consent_ids).toEqual(['11111111-1111-4111-8111-111111111111'])
  expect(clinicalWriteCalled).toBe(false)
})

test('link inválido não revela paciente nem formulário', async ({ page }) => {
  await page.route('**/rest/v1/rpc/get_public_clinical_intake*', route => route.fulfill({ status:400, contentType:'application/json', body:JSON.stringify({ message:'invalid' }) }))
  await page.goto(`/anamnese/${'b'.repeat(64)}`)
  await expect(page.getByText('Formulário indisponível')).toBeVisible()
  await expect(page.getByText('Este link é inválido, expirou, foi revogado ou já foi utilizado.')).toBeVisible()
})
