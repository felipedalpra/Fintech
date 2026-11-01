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
