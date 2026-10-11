import { expect, test } from '@playwright/test'

const OPPS = [
  { id: 'o1', title: 'Rinoplastia', stage: 'consulta_agendada', status: 'aberto', value: 15000, source: 'Instagram', tags: [], stage_entered_at: '2026-10-07T12:00:00Z', created_at: '2026-10-06T10:00:00Z', patient_id: 'p1', responsible_user_id: null, suggestion_status: 'none', patients: { full_name: 'Ana Silva', phone: '11988887777' } },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ } })
  await page.route('**/rest/v1/opportunities*', route =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(OPPS) })
      : route.continue())
  // Fontes das abas vazias (GET) → tabs renderizam sem depender de backend.
  for (const t of ['tasks', 'opportunity_stage_history', 'whatsapp_messages', 'opportunity_notes']) {
    await page.route(`**/rest/v1/${t}*`, route =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        : route.continue())
  }
})

test('aba Tarefas aparece ao editar e mostra o formulário de nova tarefa', async ({ page }) => {
  await page.goto('/app/funnel')
  await page.getByText('Ana Silva').click()
  await expect(page.getByRole('button', { name: 'Tarefas' })).toBeVisible()
  await page.getByRole('button', { name: 'Tarefas' }).click()
  await expect(page.getByPlaceholder('Nova tarefa…')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Adicionar' })).toBeVisible()
})

test('aba Timeline monta a linha do tempo (evento de criação) e permite nota', async ({ page }) => {
  await page.goto('/app/funnel')
  await page.getByText('Ana Silva').click()
  await page.getByRole('button', { name: 'Timeline' }).click()
  await expect(page.getByPlaceholder('Registrar nota…')).toBeVisible()
  await expect(page.getByText('Oportunidade criada')).toBeVisible()
})
