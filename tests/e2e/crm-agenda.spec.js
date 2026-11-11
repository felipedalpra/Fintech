import { expect, test } from '@playwright/test'

// CRM → Agenda (Fase 5). Backend mockado por rota; os testes conferem o que foi ENVIADO ao banco:
// reagendar grava no registro original (tarefa / oportunidade), nunca numa tabela paralela.
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

// "Hoje" no fuso da clínica, como a Agenda calcula.
function clinicToday() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const TODAY = clinicToday()
// Fica sempre dentro da grade do mês exibido (que mostra 42 dias a partir da semana do dia 1º).
const D1 = addDays(TODAY, 1)
const D2 = addDays(TODAY, 2)
const D3 = addDays(TODAY, 3)

const OPPS = [
  { id: 'o1', title: 'Rinoplastia', stage: 'consultado', status: 'aberto', value: 25000, source: 'Instagram', tags: [], stage_entered_at: '2026-10-07T12:00:00Z', created_at: '2026-10-06T10:00:00Z', patient_id: 'p1', responsible_user_id: 'u1', suggestion_status: 'none', procedure_id: null, probability: null, next_action: 'Retornar proposta', next_action_due: D1, expected_surgery_date: null, custom_values: {}, patients: { full_name: 'Ana Silva', phone: '61999990000' } },
  { id: 'o2', title: 'Lipo', stage: 'orcamento_enviado', status: 'perdido', value: 9000, source: 'Google', tags: [], stage_entered_at: '2026-10-01T12:00:00Z', created_at: '2026-09-20T10:00:00Z', patient_id: 'p2', responsible_user_id: 'u1', suggestion_status: 'none', procedure_id: null, probability: null, next_action: 'Não deve aparecer', next_action_due: D1, expected_surgery_date: null, custom_values: {}, patients: { full_name: 'Bia Souza', phone: '' } },
]
const TASKS = [
  { id: 't1', title: 'Ligar para Ana', due_date: D1, due_time: '10:00', task_type: 'ligar', status: 'pendente', outcome: null, assigned_user_id: 'u2', done_at: null, created_at: '2026-10-08T10:00:00Z', opportunity_id: 'o1', patient_id: 'p1', patients: { full_name: 'Ana Silva', phone: '61999990000' }, opportunities: { title: 'Rinoplastia' } },
  { id: 't2', title: 'Separar documentos', due_date: D2, due_time: null, task_type: 'documento', status: 'pendente', outcome: null, assigned_user_id: 'u1', done_at: null, created_at: '2026-10-08T11:00:00Z', opportunity_id: null, patient_id: null, patients: null, opportunities: null },
]

async function mockBackend(page) {
  const calls = { taskPatches: [], oppPatches: [], taskInserts: [] }
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('surgimetrics_onboarded', 'true')
      window.localStorage.setItem('surgimetrics_crm_agenda_v1:e2e-user-id', JSON.stringify({ view: 'month' }))
    } catch { /* ignore */ }
  })
  // Evita que carregamentos gerais do workspace escapem para o Supabase real no
  // primeiro teste do servidor frio. As rotas específicas abaixo têm precedência.
  await page.route('**/rest/v1/**', route => route.fulfill(json([])))
  await page.route('**/rest/v1/rpc/clinic_team', route => route.fulfill(json([
    { user_id: 'u1', member_email: 'ana@clinica.com', role: 'gestao' },
    { user_id: 'u2', member_email: 'felipe@clinica.com', role: 'equipe' },
  ])))
  await page.route('**/rest/v1/rpc/crm_last_contact', route => route.fulfill(json([])))
  await page.route('**/rest/v1/procedures*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/opportunities*', route => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill(json(OPPS))
    if (req.method() === 'PATCH') {
      calls.oppPatches.push(req.postDataJSON())
      return route.fulfill(json([{ id: new URL(req.url()).searchParams.get('id')?.replace('eq.', '') }]))
    }
    return route.continue()
  })
  await page.route('**/rest/v1/tasks*', route => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill(json(TASKS))
    if (req.method() === 'PATCH') {
      calls.taskPatches.push({ id: new URL(req.url()).searchParams.get('id')?.replace('eq.', ''), body: req.postDataJSON() })
      return route.fulfill(json([{ id: new URL(req.url()).searchParams.get('id')?.replace('eq.', '') }]))
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      calls.taskInserts.push(body)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 't-new', done_at: null, outcome: null, created_at: new Date().toISOString(), ...body }) })
    }
    return route.continue()
  })
  for (const t of ['crm_stage_settings', 'crm_custom_fields', 'crm_views', 'opportunity_notes']) {
    await page.route(`**/rest/v1/${t}*`, route => (route.request().method() === 'GET' ? route.fulfill(json([])) : route.continue()))
  }
  // Endpoints de migrações opcionais respondendo como "ainda não aplicada" (resposta rápida).
  const missing = { status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST205', message: 'relation does not exist' }) }
  for (const p of ['**/rest/v1/task_stages*', '**/rest/v1/task_checklist_items*', '**/rest/v1/task_comments*', '**/rest/v1/task_history*',
    '**/rest/v1/rpc/task_ensure_default_stages', '**/rest/v1/rpc/crm_ensure_default_views']) {
    await page.route(p, route => route.fulfill(missing))
  }
  return calls
}

const agendaEvent = (page, id) => page.locator(`[data-testid="agenda-event"][data-event-id="${id}"]`)

test('Agenda reúne tarefas e follow-ups da clínica e abre na aba do CRM', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/app/funnel?view=agenda')
  await expect(page.getByRole('tab', { name: 'Agenda', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
  await expect(page.getByTestId('crm-agenda')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('agenda-month')).toBeVisible()

  await expect(agendaEvent(page, 'task:t1')).toHaveAttribute('data-event-type', 'followup')
  await expect(agendaEvent(page, 'task:t2')).toHaveAttribute('data-event-type', 'task')
  await expect(agendaEvent(page, 'opportunity:o1')).toHaveAttribute('data-event-type', 'followup')
  // Oportunidade perdida não tem próxima ação pendente.
  await expect(agendaEvent(page, 'opportunity:o2')).toHaveCount(0)
  // Tooltip informativo com responsável e status.
  await expect(agendaEvent(page, 'task:t1')).toHaveAttribute('title', /Responsável: felipe[\s\S]*Status: Em aberto/)

  // Semana e dia mostram o mesmo dado.
  await page.getByTestId('agenda-view-week').click()
  await expect(page.getByTestId('agenda-week')).toBeVisible()
  await page.getByTestId('agenda-view-day').click()
  await expect(page.getByTestId('agenda-day')).toBeVisible()
  await page.getByTestId('agenda-today').click()
  await page.getByTestId('agenda-next').click()
  await expect(agendaEvent(page, 'task:t1')).toBeVisible()
})

test('filtros combinam responsáveis e categorias', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/app/funnel?view=agenda')
  await expect(agendaEvent(page, 'task:t2')).toBeVisible()

  await page.getByTestId('agenda-person-u2').click()
  await expect(agendaEvent(page, 'task:t1')).toBeVisible()
  await expect(agendaEvent(page, 'task:t2')).toHaveCount(0)
  await expect(agendaEvent(page, 'opportunity:o1')).toHaveCount(0)

  // Ocultar follow-ups esconde a tarefa de contato do Felipe.
  await page.locator('label.crm-ag__cat', { hasText: 'Follow-ups' }).click()
  await expect(page.getByTestId('agenda-type-followup')).not.toBeChecked()
  await expect(agendaEvent(page, 'task:t1')).toHaveCount(0)
  await expect(page.getByTestId('agenda-chips')).toContainText('Ocultas: Follow-ups')

  await page.getByTestId('agenda-chips').getByRole('button', { name: 'Limpar filtros' }).click()
  await expect(agendaEvent(page, 'task:t1')).toBeVisible()
  await expect(agendaEvent(page, 'task:t2')).toBeVisible()
})

test('arrastar reagenda a tarefa no registro original; data passada é recusada', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/funnel?view=agenda')
  await agendaEvent(page, 'task:t2').dragTo(page.getByTestId(`agenda-day-${D3}`))
  await expect.poll(() => calls.taskPatches.length).toBe(1)
  expect(calls.taskPatches[0]).toMatchObject({ id: 't2', body: { due_date: D3 } })
  await expect(page.getByTestId(`agenda-day-${D3}`).locator('[data-event-id="task:t2"]')).toBeVisible()

  // Follow-up da oportunidade: grava next_action_due na própria oportunidade.
  await agendaEvent(page, 'opportunity:o1').dragTo(page.getByTestId(`agenda-day-${D2}`))
  await expect.poll(() => calls.oppPatches.length).toBe(1)
  expect(calls.oppPatches[0]).toMatchObject({ next_action_due: D2 })

  // Para o passado: nada é gravado.
  const yesterday = addDays(TODAY, -1)
  const pastCell = page.getByTestId(`agenda-day-${yesterday}`)
  if (await pastCell.count()) {
    await agendaEvent(page, 'task:t1').dragTo(pastCell)
    await expect(page.getByText('Não é possível reagendar para uma data que já passou.')).toBeVisible()
    expect(calls.taskPatches).toHaveLength(1)
  }
})

test('clicar abre o painel da tarefa (o mesmo da página Tarefas) e o painel do follow-up', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/app/funnel?view=agenda')
  await agendaEvent(page, 'task:t2').click()
  await expect(page.getByTestId('task-drawer')).toBeVisible()
  await page.getByTestId('task-drawer-close').click()

  await agendaEvent(page, 'opportunity:o1').click()
  const panel = page.getByTestId('agenda-event-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Retornar proposta')
  await expect(panel).toContainText('Ana Silva')
  await panel.getByRole('button', { name: 'Abrir oportunidade' }).click()
  await expect(panel).toHaveCount(0)
})

test('clicar num dia vazio cria follow-up como tarefa vinculada à oportunidade', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/funnel?view=agenda')
  await page.getByTestId(`agenda-day-${D3}`).click({ position: { x: 60, y: 90 } })
  await expect(page.getByRole('heading', { name: 'Nova atividade' })).toBeVisible()
  await page.getByTestId('new-activity-followup').click()
  await page.getByPlaceholder('Ex.: Ligar para confirmar o orçamento').fill('Confirmar data da cirurgia')
  await page.locator('select').filter({ hasText: 'Selecione a oportunidade' }).selectOption('o1')
  await page.getByRole('button', { name: 'Criar follow-up' }).click()
  await expect.poll(() => calls.taskInserts.length).toBe(1)
  expect(calls.taskInserts[0]).toMatchObject({ title: 'Confirmar data da cirurgia', due_date: D3, opportunity_id: 'o1', patient_id: 'p1', task_type: 'ligar' })
  await expect(agendaEvent(page, 'task:t-new')).toHaveAttribute('data-event-type', 'followup')
})
