import { expect, test } from '@playwright/test'

// Workspace de CRM (tabela estilo Monday). Backend mockado por rota; cada teste verifica o que
// foi ENVIADO ao banco, não só a tela.
const OPPS = [
  { id: 'o1', title: 'Rinoplastia', stage: 'orcamento_enviado', status: 'aberto', value: 25000, source: 'Instagram', tags: [], stage_entered_at: '2026-10-07T12:00:00Z', created_at: '2026-10-06T10:00:00Z', patient_id: 'p1', responsible_user_id: null, suggestion_status: 'none', procedure_id: 'proc-1', probability: null, next_action: 'Ligar para negociar', next_action_due: '2026-01-10', expected_surgery_date: null, custom_values: {}, patients: { full_name: 'Ana Silva', phone: '61999990000' } },
  { id: 'o2', title: 'Oportunidade', stage: 'consulta_agendada', status: 'aberto', value: 12000, source: 'Google', tags: [], stage_entered_at: '2026-10-09T12:00:00Z', created_at: '2026-10-08T10:00:00Z', patient_id: 'p2', responsible_user_id: null, suggestion_status: 'none', procedure_id: null, probability: null, next_action: null, next_action_due: null, expected_surgery_date: null, custom_values: {}, patients: { full_name: 'Bia Souza', phone: '' } },
  { id: 'o3', title: 'Lipo', stage: 'orcamento_enviado', status: 'perdido', value: 9000, source: 'Instagram', tags: [], stage_entered_at: '2026-10-01T12:00:00Z', created_at: '2026-09-20T10:00:00Z', patient_id: 'p3', responsible_user_id: null, lost_reason: 'Achou caro', suggestion_status: 'none', procedure_id: null, probability: null, next_action: null, next_action_due: null, expected_surgery_date: null, custom_values: {}, patients: { full_name: 'Carla Dias', phone: '' } },
]

const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

async function mockBackend(page, { patchFails = false } = {}) {
  const calls = { patches: [], moves: [], fieldInserts: [], viewInserts: [] }
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ } })
  await page.route('**/rest/v1/rpc/clinic_team', route => route.fulfill(json([{ user_id: 'u1', member_email: 'lunara@clinica.com', role: 'gestao' }])))
  await page.route('**/rest/v1/rpc/crm_last_contact', route => route.fulfill(json([{ opportunity_id: 'o1', last_contact_at: new Date(Date.now() - 2 * 86400000).toISOString(), last_contact_source: 'whatsapp' }])))
  await page.route('**/rest/v1/rpc/move_opportunity', route => {
    calls.moves.push(route.request().postDataJSON())
    return route.fulfill(json({ id: 'o2' }))
  })
  await page.route('**/rest/v1/procedures*', route => route.fulfill(json([{ id: 'proc-1', name: 'Rinoplastia', price: 20000, color: '#8b5cf6' }, { id: 'proc-2', name: 'Mamoplastia', price: 30000, color: '#ec4899' }])))
  await page.route('**/rest/v1/opportunities*', route => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill(json(OPPS))
    if (req.method() === 'PATCH') {
      calls.patches.push(req.postDataJSON())
      if (patchFails) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'falha simulada' }) })
      return route.fulfill(json([{ id: new URL(req.url()).searchParams.get('id')?.replace('eq.', '') }]))
    }
    return route.continue()
  })
  for (const t of ['crm_stage_settings', 'tasks', 'opportunity_notes', 'opportunity_stage_history', 'whatsapp_messages']) {
    await page.route(`**/rest/v1/${t}*`, route => (route.request().method() === 'GET' ? route.fulfill(json([])) : route.continue()))
  }
  await page.route('**/rest/v1/crm_custom_fields*', route => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill(json([]))
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      calls.fieldInserts.push(body)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'f-new', archived_at: null, width: null, created_at: new Date().toISOString(), ...body }) })
    }
    return route.continue()
  })
  await page.route('**/rest/v1/crm_views*', route => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill(json([]))
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      calls.viewInserts.push(body)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'v-new', owner_id: 'e2e-user-id', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body }) })
    }
    return route.continue()
  })
  return calls
}

test('Tabela é a visualização padrão, com grupos por etapa, totais e abas', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/app/funnel')
  await expect(page.getByRole('heading', { name: 'CRM — Gestão de Oportunidades' })).toBeVisible()
  for (const name of ['Tabela', 'Kanban', 'Indicadores']) await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Agenda/ })).toBeDisabled()

  const orc = page.getByTestId('crm-group-orcamento_enviado')
  await expect(orc.getByRole('heading', { name: 'Orçamento Enviado' })).toBeVisible()
  await expect(orc.getByText('1 oportunidade · R$ 25.000')).toBeVisible()
  await expect(orc.getByTestId('crm-row')).toHaveCount(1)
  // Procedimento, próxima ação, prazo vencido e último contato derivado aparecem na linha.
  const ana = orc.getByTestId('crm-row').filter({ hasText: 'Ana Silva' })
  await expect(ana.getByTestId('crm-cell-procedure')).toHaveText('Rinoplastia')
  await expect(ana.getByTestId('crm-cell-next-action')).toHaveText('Ligar para negociar')
  await expect(ana.getByTestId('crm-cell-due')).toContainText('10/01/26')
  await expect(ana.getByText('há 2 dias')).toBeVisible()

  // Perdida vai para o grupo "Perdidos", recolhido por padrão.
  const lost = page.getByTestId('crm-group-perdido')
  await expect(lost.getByRole('heading', { name: 'Perdidos' })).toBeVisible()
  await expect(lost.getByTestId('crm-row')).toHaveCount(0)
  await lost.getByRole('button', { name: 'Expandir Perdidos' }).click()
  await expect(lost.getByTestId('crm-row')).toHaveCount(1)
})

test('edição inline grava só o campo alterado e reflete no Kanban', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/funnel')
  const bia = page.getByTestId('crm-row').filter({ hasText: 'Bia Souza' })

  await bia.getByTestId('crm-cell-value').click()
  const input = bia.locator('input[type="number"]')
  await input.fill('18000')
  await input.press('Enter')
  await expect(bia.getByTestId('crm-cell-value')).toHaveText('R$ 18.000')
  await expect.poll(() => calls.patches.length).toBe(1)
  expect(calls.patches[0]).toMatchObject({ value: 18000 })
  expect(Object.keys(calls.patches[0]).sort()).toEqual(['updated_at', 'value'])

  // Procedimento por lista.
  await bia.getByTestId('crm-cell-procedure').click()
  await page.getByRole('dialog', { name: 'Escolher procedimento' }).getByRole('menuitem', { name: 'Mamoplastia' }).click()
  await expect(bia.getByTestId('crm-cell-procedure')).toHaveText('Mamoplastia')
  await expect.poll(() => calls.patches.length).toBe(2)
  expect(calls.patches[1]).toMatchObject({ procedure_id: 'proc-2' })

  // Etapa muda pela RPC auditada (não por update direto).
  await bia.getByTestId('crm-cell-stage').click()
  await page.getByRole('dialog', { name: 'Mudar etapa' }).getByRole('option', { name: 'Consultado' }).click()
  await expect.poll(() => calls.moves.length).toBe(1)
  expect(calls.moves[0]).toMatchObject({ opp_id: 'o2', new_stage: 'consultado', move_source: 'manual' })
  await expect(page.getByTestId('crm-group-consultado').getByText('Bia Souza')).toBeVisible()

  // Mesma oportunidade, mesmo estado no Kanban (sem recarregar).
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click()
  const card = page.getByTestId('crm-kanban').locator('div[draggable="true"]').filter({ hasText: 'Bia Souza' })
  await expect(card.locator('select[aria-label="Mover para estágio"]')).toHaveValue('consultado')
  await expect(card.getByText('R$ 18.000')).toBeVisible()
  await expect(card.getByText('Mamoplastia')).toBeVisible()
})

test('falha ao gravar desfaz a edição e avisa', async ({ page }) => {
  await mockBackend(page, { patchFails: true })
  await page.goto('/app/funnel')
  const bia = page.getByTestId('crm-row').filter({ hasText: 'Bia Souza' })
  await bia.getByTestId('crm-cell-value').click()
  await bia.locator('input[type="number"]').fill('99999')
  await bia.locator('input[type="number"]').press('Enter')
  await expect(page.getByText('Não foi possível salvar. A alteração foi desfeita.')).toBeVisible()
  await expect(bia.getByTestId('crm-cell-value')).toHaveText('R$ 12.000')
})

test('agrupar por responsável não muda a etapa de ninguém; filtros combinam e valem para o Kanban', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/funnel')
  await page.getByTestId('crm-group-button').click()
  await page.getByRole('menuitem', { name: 'Responsável' }).click()
  await expect(page.getByTestId('crm-group-none').getByRole('heading', { name: 'Sem responsável' })).toBeVisible()
  expect(calls.moves).toHaveLength(0)
  expect(calls.patches).toHaveLength(0)

  // Filtro: etapa Orçamento enviado + situação abertas → só a Ana.
  await page.getByTestId('crm-filter-button').click()
  const panel = page.getByTestId('crm-filter-panel')
  await panel.getByRole('button', { name: 'Orçamento Enviado' }).click()
  await panel.getByRole('button', { name: 'Abertas' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('crm-row')).toHaveCount(1)
  await expect(page.getByTestId('crm-row').first()).toContainText('Ana Silva')

  await page.getByRole('tab', { name: 'Kanban', exact: true }).click()
  const kanban = page.getByTestId('crm-kanban')
  await expect(kanban.getByText('Ana Silva')).toBeVisible()
  await expect(kanban.getByText('Bia Souza')).toHaveCount(0)
})

test('ocultar coluna e preferência sobrevive ao recarregar', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/app/funnel')
  await expect(page.getByRole('columnheader', { name: /Origem do lead/ }).first()).toBeVisible()
  await page.getByTestId('crm-hide-button').click()
  await page.getByRole('dialog', { name: 'Mostrar ou ocultar colunas' }).getByLabel('Origem do lead').uncheck()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('columnheader', { name: /Origem do lead/ })).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('crm-row').first()).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Origem do lead/ })).toHaveCount(0)
})

test('gestão cria coluna personalizada e salva visualização', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_e2e_role', 'gestao') } catch { /* ignore */ } })
  const calls = await mockBackend(page)
  await page.goto('/app/funnel')
  await page.getByTestId('crm-columns-plus').first().click()
  await page.getByTestId('crm-new-column').click()
  await page.getByLabel('Nome da coluna').fill('Indicação')
  await page.getByLabel('Tipo').selectOption('select')
  await page.getByLabel('Nome da opção 1').fill('Paciente antiga')
  await page.getByRole('button', { name: 'Criar coluna' }).click()
  await expect.poll(() => calls.fieldInserts.length).toBe(1)
  expect(calls.fieldInserts[0]).toMatchObject({ label: 'Indicação', field_type: 'select', user_id: 'e2e-user-id' })
  expect(calls.fieldInserts[0].options[0]).toMatchObject({ label: 'Paciente antiga' })
  await expect(page.getByRole('columnheader', { name: /Indicação/ }).first()).toBeVisible()

  await page.getByTestId('crm-new-view').click()
  await page.getByLabel('Nome').fill('Orçamentos da semana')
  await page.getByLabel(/Toda a equipe/).check()
  await page.getByRole('button', { name: 'Salvar visualização' }).click()
  await expect.poll(() => calls.viewInserts.length).toBe(1)
  expect(calls.viewInserts[0]).toMatchObject({ name: 'Orçamentos da semana', scope: 'shared', view_type: 'table' })
  expect(calls.viewInserts[0].config).toHaveProperty('groupBy', 'stage')
  await expect(page.getByRole('tab', { name: /Orçamentos da semana/ })).toHaveAttribute('aria-selected', 'true')
})

test('equipe não vê criação de coluna nem pode compartilhar visualização', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_e2e_role', 'equipe') } catch { /* ignore */ } })
  await mockBackend(page)
  await page.goto('/app/funnel')
  await page.getByTestId('crm-columns-plus').first().click()
  await expect(page.getByTestId('crm-new-column')).toHaveCount(0)
  await expect(page.getByText('Somente Administrador e Gestão criam ou alteram colunas personalizadas.')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByTestId('crm-new-view').click()
  await expect(page.getByLabel(/Toda a equipe/)).toBeDisabled()
})

test('sem a migração aplicada o CRM continua funcionando com os campos atuais', async ({ page }) => {
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ } })
  await page.route('**/rest/v1/rpc/clinic_team', route => route.fulfill(json([])))
  await page.route('**/rest/v1/rpc/crm_last_contact', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', message: 'not found' }) }))
  await page.route('**/rest/v1/opportunities*', route => {
    const url = route.request().url()
    if (url.includes('custom_values')) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '42703', message: 'column opportunities.procedure_id does not exist' }) })
    return route.fulfill(json(OPPS.map(({ procedure_id, probability, next_action, next_action_due, expected_surgery_date, custom_values, ...o }) => o)))
  })
  for (const t of ['crm_stage_settings', 'crm_custom_fields', 'crm_views']) {
    await page.route(`**/rest/v1/${t}*`, route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST205', message: 'not found' }) }))
  }
  for (const t of ['tasks', 'opportunity_notes']) await page.route(`**/rest/v1/${t}*`, route => route.fulfill(json([])))
  await page.goto('/app/funnel')
  await expect(page.getByTestId('crm-row').filter({ hasText: 'Ana Silva' })).toBeVisible()
  await expect(page.getByText(/crm_workspace_phase1\.sql/)).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Procedimento/ })).toHaveCount(0)
  await expect(page.getByTestId('crm-new-view')).toHaveCount(0)
})
