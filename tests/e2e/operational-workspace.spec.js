import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  for (const table of ['tasks', 'opportunities', 'whatsapp_messages', 'whatsapp_numbers', 'crm_contacts', 'whatsapp_conversation_states', 'workspace_preferences', 'meta_connections']) {
    await page.route(`**/rest/v1/${table}*`, route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  }
  await page.route('**/rest/v1/rpc/clinic_team*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
})

test('navegação simplificada abre Meu dia e qualidade financeira', async ({ page }) => {
  await page.goto('/app/meu-dia')
  await expect(page.getByRole('button', { name:'Hoje', exact:true })).toBeVisible()
  await expect(page.getByRole('button', { name:'Relacionamento', exact:true })).toBeVisible()
  await expect(page.getByRole('button', { name:'Atendimentos', exact:true })).toBeVisible()
  await expect(page.getByText('Conversas não lidas')).toBeVisible()
  await page.getByText('Qualidade financeira').click()
  await expect(page).toHaveURL(/\/app\/data-quality$/)
  await expect(page.getByTestId('data-quality-center')).toBeVisible()
  await expect(page.getByText('Esta tela não altera totais')).toBeVisible()
})

test('configurações mostram saúde das integrações sem segredos', async ({ page }) => {
  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Integrações', exact:true }).click()
  await expect(page.getByRole('heading', { name:'Saúde das integrações' })).toBeVisible()
  await expect(page.locator('strong').filter({ hasText:/^WhatsApp$/ })).toBeVisible()
  await expect(page.locator('strong').filter({ hasText:/^Meta Ads$/ })).toBeVisible()
  await expect(page.locator('strong').filter({ hasText:/^Google Agenda$/ })).toBeVisible()
  await expect(page.locator('strong').filter({ hasText:/^Banco \/ conciliação$/ })).toBeVisible()
})
