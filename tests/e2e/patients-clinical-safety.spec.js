import { expect, test } from '@playwright/test'

test('falha ao carregar o perfil clínico bloqueia edição para não sobrescrever anamnese', async ({ page }) => {
  await page.route('**/rest/v1/patients*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([{ id:'patient-1', full_name:'Paciente preservada', active:true }]),
  }))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({
    status:500,
    contentType:'application/json',
    body:JSON.stringify({ message:'falha simulada de RLS' }),
  }))

  await page.goto('/app/patients')

  await expect(page.getByRole('alert')).toContainText('A edição foi bloqueada')
  await expect(page.getByRole('button', { name:'+ Novo paciente' })).toBeDisabled()
  await expect(page.getByText('Paciente preservada')).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Tentar novamente' })).toBeVisible()
})

test('não arquiva paciente na interface quando o banco recusa a alteração', async ({ page }) => {
  await page.route('**/rest/v1/**', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/patients*', route => {
    if (route.request().method() === 'PATCH') return route.fulfill({
      status:403,
      contentType:'application/json',
      body:JSON.stringify({ code:'42501', message:'RLS recusou a alteração' }),
    })
    return route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify([{ id:'patient-1', full_name:'Paciente preservada', active:true }]),
    })
  })
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))

  await page.goto('/app/patients')
  await expect(page.getByText('Paciente preservada')).toBeVisible()
  await page.getByRole('button', { name:'Arquivar' }).click()
  await page.getByRole('button', { name:'Arquivar', exact:true }).last().click()

  await expect(page.getByRole('alert')).toContainText('NÃO foi arquivado')
  await expect(page.getByText('Paciente preservada')).toBeVisible()
})

test('salva cadastro e dados clínicos juntos e só fecha após confirmação integral', async ({ page }) => {
  let rpcPayload = null
  await page.route('**/rest/v1/patients*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:'[]',
  }))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:'[]',
  }))
  await page.route('**/rest/v1/rpc/save_patient_with_clinical_profile*', async route => {
    rpcPayload = route.request().postDataJSON()
    await route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify({
        patient:{ id:'patient-new', user_id:'e2e-user-id', active:true, ...rpcPayload.p_patient },
        clinical_profile:{ patient_id:'patient-new', user_id:'e2e-user-id', ...rpcPayload.p_clinical },
      }),
    })
  })

  await page.goto('/app/patients')
  await page.getByRole('button', { name:'+ Novo paciente' }).click()
  await page.getByRole('button', { name:'Expandir' }).click()
  await expect(page.getByRole('button', { name:'Reduzir' })).toHaveAttribute('aria-expanded', 'true')
  await page.getByLabel('Nome completo').fill('Paciente Persistida')
  await page.getByRole('button', { name:/4\. Clínico/ }).click()
  await page.getByPlaceholder('Motivo da busca pelo atendimento…').fill('Avaliação pré-operatória')
  await page.getByRole('button', { name:/5\. Anamnese/ }).click()
  await page.getByPlaceholder('Descreva o histórico e evolução da queixa principal…').fill('História clínica completa')
  await page.getByPlaceholder('Nome, dose e frequência de cada medicamento…').fill('Losartana 50 mg, uma vez ao dia')
  await page.getByRole('button', { name:/7\. Revisão/ }).click()
  await page.getByRole('button', { name:'Salvar paciente' }).click()

  await expect.poll(() => rpcPayload, { timeout:10_000 }).not.toBeNull()
  await expect(page.getByRole('heading', { name:'Novo paciente' })).toHaveCount(0)
  await expect(page.getByText('Paciente Persistida')).toBeVisible()
  expect(rpcPayload.p_patient_id).toBeNull()
  expect(rpcPayload.p_patient).toMatchObject({ full_name:'Paciente Persistida' })
  expect(rpcPayload.p_clinical).toMatchObject({
    chief_complaint:'Avaliação pré-operatória',
    hda:'História clínica completa',
    current_medications:'Losartana 50 mg, uma vez ao dia',
  })
})
