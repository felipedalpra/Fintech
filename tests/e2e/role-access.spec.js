import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/**', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"configured":false,"connected":false}' }))
})

test('equipe não recebe dados ou ações financeiras na interface', async ({ page }) => {
  await page.goto('/app/meu-dia')

  await expect(page.getByRole('button', { name:'Financeiro', exact:true })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Configurações', exact:true })).toHaveCount(0)
  await expect(page.getByText('Qualidade financeira', { exact:true })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Alertas', exact:true })).toHaveCount(0)
  await expect(page.getByTitle('Abrir copiloto')).toHaveCount(0)

  await expect(page.getByText('Cadastrar primeiro contato', { exact:true })).toBeVisible()
  await expect(page.getByText('Revisar plano de contas', { exact:true })).toHaveCount(0)
  await expect(page.getByText('Registrar primeiro lançamento', { exact:true })).toHaveCount(0)

  await page.getByTitle('Lançamento rápido').click()
  await expect(page.getByRole('button', { name:/Nova consulta$/ })).toBeVisible()
  await expect(page.getByRole('button', { name:/Nova cirurgia$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name:/Nova despesa$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name:/Nova receita$/ })).toHaveCount(0)
})
