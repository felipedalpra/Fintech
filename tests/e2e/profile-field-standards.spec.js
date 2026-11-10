import { expect, test } from '@playwright/test'

test('perfil orienta CRM e RQE e impede contatos e documentos fora do padrão', async ({ page }) => {
  let savedProfile = null
  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_e2e_role', 'admin'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"configured":false,"connected":false}' }))
  await page.route('**/api/secure-profile?action=*', async route => {
    const action = new URL(route.request().url()).searchParams.get('action')
    if (action === 'save') savedProfile = (await route.request().postDataJSON()).profile
    const profile = savedProfile || {
      doctor:{ fullName:'Dra. Vitória', registrationId:'CRM-DF 29500', rqe:'1234', cpf:'529.982.247-25' },
      clinic:{ tradeName:'Clínica E2E', state:'DF' },
    }
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ profile }) })
  })
  await page.route('**/rest/v1/**', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))

  await page.goto('/app/settings')
  await expect(page.getByLabel('Conselho profissional')).toHaveValue('CRM', { timeout:10_000 })
  await expect(page.getByLabel('UF do CRM')).toHaveValue('DF')
  await expect(page.getByLabel('Número do CRM')).toHaveValue('29500')

  await page.getByLabel('UF do CRM').selectOption('RS')
  await page.getByLabel('Número do CRM').fill('abc12345')
  await expect(page.getByLabel('Número do CRM')).toHaveValue('12345')
  await page.getByLabel('Número do CRM').fill('1234567890123')
  await expect(page.getByLabel('Número do CRM')).toHaveValue('1234567890')
  await expect(page.getByText('Será salvo como CRM-RS 1234567890')).toBeVisible()

  await page.getByLabel('RQE (se houver)').fill('RQE 9988')
  await expect(page.getByLabel('RQE (se houver)')).toHaveValue('9988')
  await page.getByLabel('Telefone', { exact:true }).fill('51991897471')
  await page.getByLabel('E-mail profissional').fill('email-invalido')
  await page.getByLabel('E-mail profissional').blur()
  await expect(page.getByText('E-mail inválido.')).toBeVisible()
  await page.getByLabel('E-mail profissional').fill(' Medica@Clinica.COM ')
  await page.getByLabel('CNPJ / CPF').fill('11222333000181')
  await expect(page.getByLabel('CNPJ / CPF')).toHaveValue('11.222.333/0001-81')

  await page.getByRole('button', { name:'Salvar configurações seguras' }).click()
  await expect.poll(() => savedProfile).not.toBeNull()
  expect(savedProfile.doctor).toMatchObject({
    registrationId:'CRM-RS 1234567890', rqe:'9988', phone:'(51) 99189-7471', email:'medica@clinica.com',
  })
})
