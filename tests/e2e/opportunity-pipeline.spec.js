import { expect, test } from '@playwright/test'

const OPPS = [
  { id: 'o1', title: 'Rinoplastia', stage: 'consulta_agendada', status: 'aberto', value: 15000, source: 'Instagram', tags: ['retorno'], stage_entered_at: '2026-10-07T12:00:00Z', patient_id: 'p1', patients: { full_name: 'Ana Silva', phone: '11988887777' } },
  { id: 'o2', title: 'Oportunidade', stage: 'orcamento_enviado', status: 'aberto', value: 30000, source: null, tags: [], stage_entered_at: '2026-10-09T12:00:00Z', patient_id: 'p2', patients: { full_name: 'Bia Souza', phone: '' } },
  { id: 'o3', title: 'Blefaroplastia', stage: 'primeiro_contato', status: 'aberto', value: null, source: 'whatsapp', tags: [], stage_entered_at: '2026-10-10T12:00:00Z', patient_id: null, contact_id: 'c1', patients: null, crm_contacts: { full_name: 'Carla Contato', phone: '5511977776666', status: 'lead' } },
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

test('pipeline mostra oportunidades por estágio com valor', async ({ page }) => {
  await page.goto('/app/funnel')
  await expect(page).toHaveURL(/\/app\/funnel$/)
  await expect(page.getByRole('heading', { name: 'Pipeline de Oportunidades' })).toBeVisible()

  for (const label of ['Consulta Agendada', 'Consultado', 'Orçamento Enviado', 'Reserva Paga', 'Follow-up']) {
    await expect(page.locator('span', { hasText: new RegExp(`^${label}$`) })).toBeVisible()
  }

  await expect(page.getByText('Ana Silva')).toBeVisible()
  await expect(page.getByText('Bia Souza')).toBeVisible()
  await expect(page.getByText('Carla Contato')).toBeVisible()
  // R$ 15.000 aparece na soma da coluna e no card — basta um visível.
  await expect(page.getByText('R$ 15.000').first()).toBeVisible()
})

test('mover oportunidade via RPC reflete na hora (update otimista persiste)', async ({ page }) => {
  // RPC de movimentação mockada com sucesso → sem rollback.
  await page.route('**/move_opportunity*', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...OPPS[0], stage: 'consultado' }) }))

  await page.goto('/app/funnel')
  await expect(page.getByText('Ana Silva')).toBeVisible()

  // Localiza o card da Ana pela identidade, sem depender da ordem de outros contatos.
  const anaCard = page.locator('div[draggable="true"]').filter({ hasText:'Ana Silva' })
  const anaSelect = anaCard.locator('select[aria-label="Mover para estágio"]')
  await expect(anaSelect).toHaveValue('consulta_agendada')

  await anaSelect.selectOption('consultado')

  // Como a RPC retornou sucesso, o update otimista persiste: Ana agora está em "Consultado".
  await expect(anaCard.locator('select[aria-label="Mover para estágio"]')).toHaveValue('consultado')
})
