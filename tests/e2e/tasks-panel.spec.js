import { expect, test } from '@playwright/test'

const TASKS = [
  { id: 't1', title: 'Ligar pra Ana', due_date: '2026-10-09', status: 'pendente', assigned_user_id: null, done_at: null, created_at: '2026-10-08T10:00:00Z', opportunity_id: 'o1', patient_id: 'p1', patients: { full_name: 'Ana Silva' }, opportunities: { title: 'Rinoplastia' } },
  { id: 't2', title: 'Cobrar sinal', due_date: null, status: 'pendente', assigned_user_id: null, done_at: null, created_at: '2026-10-08T11:00:00Z', opportunity_id: null, patient_id: null, patients: null, opportunities: null },
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ } })
  await page.route('**/rest/v1/tasks*', route =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TASKS) })
      : route.continue())
})

test('painel de tarefas lista agrupado e tem filtro + nova avulsa', async ({ page }) => {
  await page.goto('/app/tarefas')
  await expect(page).toHaveURL(/\/app\/tarefas$/)

  await expect(page.getByRole('button', { name: 'Minhas' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Todas' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nova tarefa', exact: true })).toBeVisible()

  // Tarefa atrasada e a avulsa (sem data → futura) aparecem; vínculo "avulsa" visível.
  await expect(page.getByText('Ligar pra Ana')).toBeVisible()
  await expect(page.getByText('Cobrar sinal')).toBeVisible()
  await expect(page.getByText('avulsa', { exact: true })).toBeVisible()
})

test('botão abre o modal de nova tarefa avulsa', async ({ page }) => {
  await page.goto('/app/tarefas')
  await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Nova tarefa avulsa' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Criar tarefa' })).toBeVisible()
})
