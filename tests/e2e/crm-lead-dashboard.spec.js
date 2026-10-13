import { expect, test } from '@playwright/test'

const OPPS = [
  { id: 'o1', title: 'Rinoplastia', stage: 'consultado', status: 'aberto', value: 15000, source: 'Instagram', tags: [], stage_entered_at: '2026-10-07T12:00:00Z', created_at: '2026-10-05T12:00:00Z', patient_id: 'p1', responsible_user_id: null, lost_reason: null, suggestion_status: 'none', patients: { full_name: 'Ana Silva', phone: '11988887777' } },
  { id: 'o2', title: 'Mamoplastia', stage: 'cirurgia_feita', status: 'ganho', value: 30000, source: 'Indicação', tags: [], stage_entered_at: '2026-10-09T12:00:00Z', created_at: '2026-10-02T12:00:00Z', patient_id: 'p2', responsible_user_id: null, lost_reason: null, suggestion_status: 'none', patients: { full_name: 'Bia Souza', phone: '' } },
  { id: 'o3', title: 'Lipo', stage: 'orcamento_enviado', status: 'perdido', value: 12000, source: 'Instagram', tags: [], stage_entered_at: '2026-10-08T12:00:00Z', created_at: '2026-10-03T12:00:00Z', patient_id: 'p3', responsible_user_id: null, lost_reason: 'Achou caro', suggestion_status: 'none', patients: { full_name: 'Carla Dias', phone: '' } },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ } })
  await page.route('**/rest/v1/opportunities*', route =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OPPS) })
      : route.continue())
  await page.route('**/rest/v1/opportunity_stage_history*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
})

test('botão "Novo lead" abre o modal com os campos essenciais', async ({ page }) => {
  await page.goto('/app/funnel')
  await page.getByRole('button', { name: 'Novo lead', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Novo lead' })).toBeVisible()
  await expect(page.getByPlaceholder('Nome do lead')).toBeVisible()
  await expect(page.getByText('Procedimento de interesse')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Criar lead' })).toBeVisible()
})

test('quick-add inline aparece em cada coluna do funil', async ({ page }) => {
  await page.goto('/app/funnel')
  await expect(page.getByRole('button', { name: 'Adicionar lead rápido' }).first()).toBeVisible()
})

test('Painel de CRM renderiza KPIs e o funil de conversão', async ({ page }) => {
  await page.goto('/app/crm-painel')
  await expect(page).toHaveURL(/\/app\/crm-painel$/)
  await expect(page.getByText('Taxa de conversão', { exact: true })).toBeVisible()
  await expect(page.getByText('Pipeline ponderado', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Funil de conversão' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Motivos de perda' })).toBeVisible()
})
