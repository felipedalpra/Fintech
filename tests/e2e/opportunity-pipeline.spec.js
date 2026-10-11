import { expect, test } from '@playwright/test'

const OPPS = [
  { id: 'o1', title: 'Rinoplastia', stage: 'consulta_agendada', status: 'aberto', value: 15000, source: 'Instagram', tags: ['retorno'], stage_entered_at: '2026-10-07T12:00:00Z', patient_id: 'p1', patients: { full_name: 'Ana Silva', phone: '11988887777' } },
  { id: 'o2', title: 'Oportunidade', stage: 'orcamento_enviado', status: 'aberto', value: 30000, source: null, tags: [], stage_entered_at: '2026-10-09T12:00:00Z', patient_id: 'p2', patients: { full_name: 'Bia Souza', phone: '' } },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
  await page.route('**/rest/v1/opportunities*', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OPPS) })
    }
    return route.continue()
  })
})

test('pipeline mostra oportunidades por estágio com valor', async ({ page }) => {
  await page.goto('/app/funnel')
  await expect(page).toHaveURL(/\/app\/funnel$/)
  await expect(page.getByRole('heading', { name: 'Pipeline de Oportunidades' })).toBeVisible()

  for (const label of ['Consulta Agendada', 'Consultado', 'Orçamento Enviado', 'Reserva Paga', 'Follow-up']) {
    await expect(page.locator('span', { hasText: new RegExp(`^${label}$`) })).toBeVisible()
  }

  await expect(page.getByText('Ana Silva')).toBeVisible()
  await expect(page.getByText('Bia Souza')).toBeVisible()
  // R$ 15.000 aparece na soma da coluna e no card — basta um visível.
  await expect(page.getByText('R$ 15.000').first()).toBeVisible()
})

test('mover oportunidade via RPC reflete na hora (update otimista persiste)', async ({ page }) => {
  // RPC de movimentação mockada com sucesso → sem rollback.
  await page.route('**/move_opportunity*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...OPPS[0], stage: 'consultado' }) }))

  await page.goto('/app/funnel')
  await expect(page.getByText('Ana Silva')).toBeVisible()

  // Ana está em "Consulta Agendada" (1ª coluna) → seu select é o primeiro.
  const anaSelect = page.locator('select[aria-label="Mover para estágio"]').first()
  await expect(anaSelect).toHaveValue('consulta_agendada')

  await anaSelect.selectOption('consultado')

  // Como a RPC retornou sucesso, o update otimista persiste: Ana agora está em "Consultado".
  await expect(page.locator('select[aria-label="Mover para estágio"]').first()).toHaveValue('consultado')
})
