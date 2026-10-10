import { expect, test } from '@playwright/test'

// Pacientes fake retornados no lugar do Supabase real (e2e não tem banco).
const FAKE_PATIENTS = [
  { id: 'p1', full_name: 'Ana Teste', phone: '(11) 99999-0000', start_date: '2026-01-10', funnel_stage: 'consulta_agendada' },
  { id: 'p2', full_name: 'Bia Teste', phone: '(11) 98888-7777', start_date: '2026-02-05', funnel_stage: 'orcamento_enviado' },
]

// Intercepta as chamadas REST à tabela patients: GET devolve os fakes, PATCH confirma a movimentação.
async function mockPatients(page) {
  await page.route('**/rest/v1/patients*', async route => {
    const req = route.request()
    if (req.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-range': '0-1/2' },
        body: JSON.stringify(FAKE_PATIENTS),
      })
    }
    if (req.method() === 'PATCH') {
      return route.fulfill({ status: 204, body: '' })
    }
    return route.continue()
  })
}

test('funil lista pacientes nas colunas certas por estágio', async ({ page }) => {
  await mockPatients(page)
  await page.goto('/app/funnel')

  await expect(page).toHaveURL(/\/app\/funnel$/)
  await expect(page.getByRole('heading', { name: 'Funil de Jornada' })).toBeVisible()

  // As 5 colunas de estágio aparecem (título é um <span>; evita casar com as <option> dos selects).
  for (const label of ['Consulta Agendada', 'Consultado', 'Orçamento Enviado', 'Reserva Paga', 'Follow-up']) {
    await expect(page.locator('span', { hasText: new RegExp(`^${label}$`) })).toBeVisible()
  }

  // Cada paciente aparece na coluna do seu estágio.
  await expect(page.getByText('Ana Teste')).toBeVisible()
  await expect(page.getByText('Bia Teste')).toBeVisible()
})

test('mover um paciente de estágio persiste (PATCH) e reflete na hora', async ({ page }) => {
  await mockPatients(page)
  await page.goto('/app/funnel')
  await expect(page.getByText('Ana Teste')).toBeVisible()

  // Ana está em "Consulta Agendada" (primeira coluna) → seu select é o primeiro.
  const anaSelect = page.locator('select[aria-label="Mover para estágio"]').first()
  await expect(anaSelect).toHaveValue('consulta_agendada')

  const patchPromise = page.waitForRequest(
    req => req.url().includes('/rest/v1/patients') && req.method() === 'PATCH'
  )
  await anaSelect.selectOption('consultado')

  // O PATCH foi enviado com o novo estágio.
  const patch = await patchPromise
  expect(patch.postDataJSON()).toMatchObject({ funnel_stage: 'consultado' })

  // Update otimista: o card de Ana agora está na coluna "Consultado".
  await expect(
    page.locator('select[aria-label="Mover para estágio"]').first()
  ).toHaveValue('consultado')
})
