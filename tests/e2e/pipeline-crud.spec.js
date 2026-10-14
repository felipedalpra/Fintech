import { expect, test } from '@playwright/test'

const OPPS = [
  { id: 'o1', title: 'Rinoplastia', stage: 'consulta_agendada', status: 'aberto', value: 15000, source: 'Instagram', tags: ['vip'], stage_entered_at: '2026-10-07T12:00:00Z', patient_id: 'p1', responsible_user_id: null, suggestion_status: 'none', patients: { full_name: 'Ana Silva', phone: '11988887777' } },
  { id: 'o2', title: 'Oportunidade', stage: 'orcamento_enviado', status: 'aberto', value: 30000, source: null, tags: [], stage_entered_at: '2026-10-09T12:00:00Z', patient_id: 'p2', responsible_user_id: null, suggestion_status: 'none', patients: { full_name: 'Bia Souza', phone: '' } },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
  await page.route('**/rest/v1/rpc/clinic_team', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/rest/v1/opportunities*', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OPPS) })
    }
    return route.continue()
  })
})

test('barra de filtros e botão criar aparecem; busca filtra por paciente', async ({ page }) => {
  await page.goto('/app/funnel')
  await expect(page.getByRole('heading', { name: 'Pipeline de Oportunidades' })).toBeVisible()

  await expect(page.getByPlaceholder('🔍 Buscar paciente…')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nova oportunidade', exact: true })).toBeVisible()

  await expect(page.getByText('Ana Silva')).toBeVisible()
  await expect(page.getByText('Bia Souza')).toBeVisible()

  // Busca por "Ana" esconde a Bia (filtro no cliente, instantâneo).
  await page.getByPlaceholder('🔍 Buscar paciente…').fill('Ana')
  await expect(page.getByText('Ana Silva')).toBeVisible()
  await expect(page.getByText('Bia Souza')).toHaveCount(0)
})

test('botão abre o editor de nova oportunidade', async ({ page }) => {
  await page.goto('/app/funnel')
  await page.getByRole('button', { name: 'Nova oportunidade', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nova oportunidade' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salvar' })).toBeVisible()
})

test('clicar num card abre o editor com o paciente e opções ganho/perdido', async ({ page }) => {
  await page.goto('/app/funnel')
  await page.getByText('Ana Silva').click()
  // O título do editor passa a mostrar a oportunidade · paciente; abas e ações de fechar existem.
  await expect(page.getByRole('heading', { name: /Ana Silva/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Timeline' })).toBeVisible()
  await expect(page.getByRole('button', { name: '✓ Ganho' })).toBeVisible()
  await expect(page.getByRole('button', { name: '✗ Perdido' })).toBeVisible()
})
