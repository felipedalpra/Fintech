import { expect, test } from '@playwright/test'

// CRM Fase 2: subitens (tarefas), seleção/edição em massa e menu contextual.
// Backend mockado por rota; cada teste confere o que foi ENVIADO ao banco, não só a tela.
const OPPS = [
  { id: 'o1', title: 'Rinoplastia', stage: 'orcamento_enviado', status: 'aberto', value: 25000, source: 'Instagram', tags: ['vip'], stage_entered_at: '2026-10-07T12:00:00Z', created_at: '2026-10-06T10:00:00Z', patient_id: 'p1', responsible_user_id: null, suggestion_status: 'none', procedure_id: null, probability: null, next_action: null, next_action_due: null, expected_surgery_date: null, custom_values: {}, patients: { full_name: 'Mariana Costa', phone: '61999990000' } },
  { id: 'o2', title: 'Oportunidade', stage: 'consulta_agendada', status: 'aberto', value: 12000, source: 'Google', tags: [], stage_entered_at: '2026-10-09T12:00:00Z', created_at: '2026-10-08T10:00:00Z', patient_id: 'p2', responsible_user_id: null, suggestion_status: 'none', procedure_id: null, probability: null, next_action: null, next_action_due: null, expected_surgery_date: null, custom_values: {}, patients: { full_name: 'Bia Souza', phone: '' } },
  { id: 'o3', title: 'Lipo', stage: 'consulta_agendada', status: 'aberto', value: 9000, source: 'Instagram', tags: [], stage_entered_at: '2026-10-01T12:00:00Z', created_at: '2026-09-20T10:00:00Z', patient_id: 'p3', responsible_user_id: null, suggestion_status: 'none', procedure_id: null, probability: null, next_action: null, next_action_due: null, expected_surgery_date: null, custom_values: {}, patients: { full_name: 'Carla Dias', phone: '' } },
]
const TASKS = [
  { id: 't1', opportunity_id: 'o1', patient_id: 'p1', title: 'Consulta realizada', status: 'feita', due_date: '2026-10-01', assigned_user_id: null, created_at: '2026-10-01T10:00:00Z' },
  { id: 't2', opportunity_id: 'o1', patient_id: 'p1', title: 'Enviar orçamento', status: 'feita', due_date: '2026-10-05', assigned_user_id: null, created_at: '2026-10-02T10:00:00Z' },
  { id: 't3', opportunity_id: 'o1', patient_id: 'p1', title: 'Realizar follow-up', status: 'pendente', due_date: '2099-01-10', assigned_user_id: null, created_at: '2026-10-03T10:00:00Z' },
  { id: 't4', opportunity_id: 'o1', patient_id: 'p1', title: 'Confirmar reserva', status: 'aguardando', due_date: null, assigned_user_id: null, created_at: '2026-10-04T10:00:00Z' },
]

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

// "in.(a,b)" / "eq.a" → ['a','b'] / ['a']
function idsOf(url) {
  const raw = new URL(url).searchParams.get('id') || ''
  if (raw.startsWith('eq.')) return [raw.slice(3)]
  if (raw.startsWith('in.(')) return raw.slice(4, -1).split(',').map(s => s.replace(/"/g, ''))
  return []
}

async function mockBackend(page) {
  const calls = { moves: [], oppPatches: [], taskPosts: [], taskPatches: [], rpc: {} }
  const status = Object.fromEntries(OPPS.map(o => [o.id, o.status]))
  await page.addInitScript(() => { try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ } })
  await page.route('**/rest/v1/rpc/clinic_team', route => route.fulfill(json([{ user_id: 'u1', member_email: 'lunara@clinica.com', role: 'gestao' }])))
  await page.route('**/rest/v1/rpc/crm_last_contact', route => route.fulfill(json([])))
  await page.route('**/rest/v1/rpc/move_opportunity', route => {
    calls.moves.push(route.request().postDataJSON())
    return route.fulfill(json({ ok: true }))
  })
  for (const name of ['crm_archive_opportunities', 'crm_restore_opportunities', 'crm_add_opportunity_tags', 'crm_duplicate_opportunity']) {
    await page.route(`**/rest/v1/rpc/${name}`, route => {
      const body = route.request().postDataJSON()
      ;(calls.rpc[name] ||= []).push(body)
      if (name === 'crm_archive_opportunities') { for (const id of body.p_ids) status[id] = 'arquivado'; return route.fulfill(json(body.p_ids.length)) }
      if (name === 'crm_restore_opportunities') { for (const id of body.p_ids) status[id] = 'aberto'; return route.fulfill(json(body.p_ids.length)) }
      if (name === 'crm_add_opportunity_tags') return route.fulfill(json(body.p_ids.length))
      const src = OPPS.find(o => o.id === body.p_id)
      return route.fulfill(json({ ...src, id: 'o-dup', status: 'aberto', patients: undefined }))
    })
  }
  await page.route('**/rest/v1/procedures*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/opportunities*', route => {
    const req = route.request()
    if (req.method() === 'GET') {
      const select = new URL(req.url()).searchParams.get('select')
      if (select === 'id,status') return route.fulfill(json(idsOf(req.url()).map(id => ({ id, status: status[id] }))))
      return route.fulfill(json(OPPS))
    }
    if (req.method() === 'PATCH') {
      calls.oppPatches.push({ ids: idsOf(req.url()), body: req.postDataJSON() })
      return route.fulfill(json(idsOf(req.url()).map(id => ({ id }))))
    }
    return route.continue()
  })
  await page.route('**/rest/v1/tasks*', route => {
    const req = route.request()
    if (req.method() === 'GET') {
      const opp = new URL(req.url()).searchParams.get('opportunity_id')
      return route.fulfill(json(opp?.startsWith('eq.') ? TASKS.filter(t => t.opportunity_id === opp.slice(3)) : TASKS))
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      calls.taskPosts.push(body)
      return route.fulfill(json({ id: `t-new-${calls.taskPosts.length}`, created_at: new Date().toISOString(), done_at: null, outcome: null, ...body }, 201))
    }
    if (req.method() === 'PATCH') {
      calls.taskPatches.push({ ids: idsOf(req.url()), body: req.postDataJSON() })
      return route.fulfill(json(idsOf(req.url()).map(id => ({ id }))))
    }
    return route.continue()
  })
  for (const t of ['crm_stage_settings', 'crm_custom_fields', 'crm_views', 'opportunity_notes', 'opportunity_stage_history', 'whatsapp_messages']) {
    await page.route(`**/rest/v1/${t}*`, route => (route.request().method() === 'GET' ? route.fulfill(json([])) : route.continue()))
  }
  return calls
}

const row = (page, name) => page.getByTestId('crm-row').filter({ hasText: name })

test('subitens: expande a oportunidade, cria tarefa vinculada e altera status/conclusão', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/funnel')
  const mariana = row(page, 'Mariana Costa')
  await expect(mariana.getByTestId('crm-row-progress')).toHaveText('2/4')

  await mariana.getByTestId('crm-row-expand').click()
  const subs = page.locator('[data-testid="crm-subitems"][data-opp-id="o1"]')
  await expect(subs.getByTestId('crm-subitem')).toHaveCount(4)
  // Abertas por prazo primeiro, concluídas no fim; status visível em cada uma.
  await expect(subs.getByTestId('crm-subitem').first()).toContainText('Realizar follow-up')
  await expect(subs.locator('[data-task-id="t4"]').getByTestId('crm-subitem-status')).toHaveText('Aguardando')
  await expect(subs.locator('[data-task-id="t1"]').getByTestId('crm-subitem-status')).toHaveText('Concluído')

  // Criar: vira um registro de `tasks` ligado à oportunidade e ao paciente (módulo existente).
  await subs.getByTestId('crm-subitem-add').click()
  await subs.getByTestId('crm-subitem-new').fill('Ligar para confirmar exames')
  await subs.getByTestId('crm-subitem-new').press('Enter')
  await expect.poll(() => calls.taskPosts.length).toBe(1)
  expect(calls.taskPosts[0]).toMatchObject({ opportunity_id: 'o1', patient_id: 'p1', title: 'Ligar para confirmar exames', status: 'pendente' })
  await expect(subs.getByTestId('crm-subitem')).toHaveCount(5)
  await expect(mariana.getByTestId('crm-row-progress')).toHaveText('2/5')

  // Status → Aguardando: limpa conclusão/desfecho no banco.
  await subs.locator('[data-task-id="t3"]').getByTestId('crm-subitem-status').click()
  await page.getByRole('dialog', { name: 'Status do subitem' }).getByRole('option', { name: 'Aguardando' }).click()
  await expect.poll(() => calls.taskPatches.length).toBe(1)
  expect(calls.taskPatches[0].ids).toEqual(['t3'])
  expect(calls.taskPatches[0].body).toMatchObject({ status: 'aguardando', done_at: null, outcome: null })

  // Marcar como concluído pelo círculo.
  await subs.locator('[data-task-id="t4"]').getByTestId('crm-subitem-done').click()
  await expect.poll(() => calls.taskPatches.length).toBe(2)
  expect(calls.taskPatches[1].body.status).toBe('feita')
  expect(calls.taskPatches[1].body.done_at).toBeTruthy()
  await expect(mariana.getByTestId('crm-row-progress')).toHaveText('3/5')

  // Recolher.
  await mariana.getByTestId('crm-row-expand').click()
  await expect(subs).toHaveCount(0)
})

test('edição em massa: etapa pela RPC auditada (uma por oportunidade) e reflete no Kanban', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/funnel')
  await row(page, 'Bia Souza').getByTestId('crm-row-select').check()
  await row(page, 'Carla Dias').getByTestId('crm-row-select').check()
  const bar = page.getByTestId('crm-bulk-bar')
  await expect(bar.getByTestId('crm-bulk-count')).toHaveText('2')

  await bar.getByTestId('crm-bulk-stage').click()
  await page.getByTestId('crm-bulk-stage-menu').getByRole('menuitem', { name: 'Reserva Paga' }).click()
  // 2+ registros pedem confirmação antes de gravar.
  expect(calls.moves).toHaveLength(0)
  await page.getByTestId('crm-bulk-confirm').click()
  await expect.poll(() => calls.moves.length).toBe(2)
  expect(calls.moves.map(m => m.opp_id).sort()).toEqual(['o2', 'o3'])
  expect(calls.moves.every(m => m.new_stage === 'reserva_paga' && m.move_source === 'manual')).toBe(true)
  await expect(page.getByTestId('crm-group-reserva_paga').getByTestId('crm-row')).toHaveCount(2)

  // Responsável: UMA escrita com os ids selecionados.
  await bar.getByTestId('crm-bulk-responsible').click()
  await page.getByTestId('crm-bulk-responsible-menu').getByRole('menuitem', { name: /lunara/ }).click()
  await page.getByTestId('crm-bulk-confirm').click()
  await expect.poll(() => calls.oppPatches.length).toBe(1)
  expect(calls.oppPatches[0].ids.sort()).toEqual(['o2', 'o3'])
  expect(calls.oppPatches[0].body).toMatchObject({ responsible_user_id: 'u1' })

  // Tags: acrescenta (RPC), sem apagar as existentes.
  await bar.getByTestId('crm-bulk-tags').click()
  await page.getByTestId('crm-bulk-tags-input').fill('retorno')
  await page.getByTestId('crm-bulk-tags-input').press('Enter')
  await page.getByTestId('crm-bulk-tags-apply').click()
  await expect.poll(() => calls.rpc.crm_add_opportunity_tags?.length || 0).toBe(1)
  expect(calls.rpc.crm_add_opportunity_tags[0]).toMatchObject({ p_tags: ['retorno'] })

  // Kanban mostra as duas na nova etapa, sem recarregar.
  await page.getByRole('tab', { name: 'Kanban', exact: true }).click()
  const card = page.getByTestId('crm-kanban').locator('div[draggable="true"]').filter({ hasText: 'Bia Souza' })
  await expect(card.locator('select[aria-label="Mover para estágio"]')).toHaveValue('reserva_paga')
})

test('arquivar em massa some da tabela e do Kanban; filtro Arquivadas mostra e permite restaurar', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/funnel')
  await row(page, 'Carla Dias').getByTestId('crm-row-select').check()
  await page.getByTestId('crm-bulk-archive').click()
  await page.getByTestId('crm-bulk-archive-confirm').click()
  await expect.poll(() => calls.rpc.crm_archive_opportunities?.length || 0).toBe(1)
  expect(calls.rpc.crm_archive_opportunities[0]).toEqual({ p_ids: ['o3'] })
  await expect(row(page, 'Carla Dias')).toHaveCount(0)
  await expect(page.getByTestId('crm-bulk-bar')).toHaveCount(0)

  await page.getByRole('tab', { name: 'Kanban', exact: true }).click()
  await expect(page.getByTestId('crm-kanban').getByText('Carla Dias')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Tabela', exact: true }).click()

  await page.getByTestId('crm-filter-button').click()
  await page.getByTestId('crm-filter-panel').getByRole('button', { name: 'Arquivadas' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('crm-group-arquivado').getByText('Carla Dias')).toBeVisible()

  await row(page, 'Carla Dias').click({ button: 'right', position: { x: 200, y: 18 } })
  await page.getByTestId('crm-menu-restore').click()
  await expect.poll(() => calls.rpc.crm_restore_opportunities?.length || 0).toBe(1)
  await expect(row(page, 'Carla Dias')).toHaveCount(0) // voltou a ser aberta: sai do filtro "Arquivadas"
})

test('menu contextual: opções, duplicar sem copiar histórico, mover etapa e criar tarefa', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/funnel')
  await row(page, 'Bia Souza').click({ button: 'right', position: { x: 200, y: 18 } })
  const menu = page.getByTestId('crm-row-menu')
  for (const name of ['Abrir detalhes', 'Duplicar oportunidade', 'Mover para outra etapa', 'Alterar responsável', 'Criar tarefa', 'Arquivar']) {
    await expect(menu.getByRole('menuitem', { name })).toBeVisible()
  }

  // Duplicar: confirma, chama a RPC e a cópia aparece com a MESMA pessoa.
  await menu.getByTestId('crm-menu-duplicate').click()
  await expect(menu).toContainText('não')
  await menu.getByTestId('crm-menu-duplicate-confirm').click()
  await expect.poll(() => calls.rpc.crm_duplicate_opportunity?.length || 0).toBe(1)
  expect(calls.rpc.crm_duplicate_opportunity[0]).toEqual({ p_id: 'o2' })
  await expect(row(page, 'Bia Souza')).toHaveCount(2)
  expect(calls.taskPosts).toHaveLength(0)

  // Mover etapa pelo menu "⋯" da linha.
  await row(page, 'Carla Dias').hover()
  await row(page, 'Carla Dias').getByTestId('crm-row-menu-button').click()
  await page.getByTestId('crm-menu-stage').click()
  await page.getByTestId('crm-row-menu').getByRole('menuitem', { name: 'Consultado' }).click()
  await expect.poll(() => calls.moves.length).toBe(1)
  expect(calls.moves[0]).toMatchObject({ opp_id: 'o3', new_stage: 'consultado' })

  // Criar tarefa: abre os subitens com o campo de nova tarefa em foco.
  await row(page, 'Mariana Costa').click({ button: 'right', position: { x: 200, y: 18 } })
  await page.getByTestId('crm-menu-task').click()
  const input = page.locator('[data-testid="crm-subitems"][data-opp-id="o1"]').getByTestId('crm-subitem-new')
  await expect(input).toBeFocused()
})
