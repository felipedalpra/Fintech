import { expect, test } from '@playwright/test'

// Fase 4 — gerenciador de tarefas estilo Monday, com a migração tasks_workspace_phase4.sql
// "aplicada" (mock). Cada teste confere o que foi ENVIADO ao banco, não só a tela.
const ME = 'e2e-user-id'
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const TODAY = iso(new Date())
const YESTERDAY = iso(new Date(Date.now() - 86400000))

const STAGES = [
  { id: 's-todo', label: 'A fazer', color: '#579bfc', base_status: 'pendente', position: 1, is_default: true, seed_key: 'todo', archived_at: null },
  { id: 's-doing', label: 'Em andamento', color: '#fdab3d', base_status: 'pendente', position: 2, is_default: false, seed_key: 'doing', archived_at: null },
  { id: 's-wait', label: 'Aguardando', color: '#a25ddc', base_status: 'aguardando', position: 3, is_default: true, seed_key: 'waiting', archived_at: null },
  { id: 's-done', label: 'Concluída', color: '#00c875', base_status: 'feita', position: 4, is_default: true, seed_key: 'done', archived_at: null },
]
const base = { due_time: null, outcome: null, done_at: null, description: null, board_position: null, created_at: '2026-11-01T10:00:00Z' }
const TASKS = [
  { ...base, id: 't1', title: 'Ligar para Mariana sobre parcelamento', status: 'pendente', stage_id: null, due_date: YESTERDAY, assigned_user_id: ME, priority: 'urgente', task_type: 'ligar', patient_id: 'p1', patients: { full_name: 'Mariana Costa', phone: '61999990000' }, opportunity_id: 'o1', opportunities: { title: 'Rinoplastia' } },
  { ...base, id: 't2', title: 'Enviar orçamento revisado', status: 'pendente', stage_id: 's-doing', due_date: TODAY, assigned_user_id: 'u1', priority: 'alta', task_type: 'orcamento', patient_id: 'p2', patients: { full_name: 'Bia Souza', phone: '' }, opportunity_id: 'o2', opportunities: { title: 'Mamoplastia' } },
  { ...base, id: 't3', title: 'Aguardar exames', status: 'aguardando', stage_id: null, due_date: null, assigned_user_id: null, priority: null, task_type: 'exames', patient_id: null, patients: null, opportunity_id: null, opportunities: null },
  { ...base, id: 't4', title: 'Pós-op D+7', status: 'feita', stage_id: null, due_date: YESTERDAY, done_at: '2026-11-08T12:00:00Z', assigned_user_id: ME, priority: 'baixa', task_type: 'pos_op', patient_id: 'p3', patients: { full_name: 'Carla Dias', phone: '' }, opportunity_id: null, opportunities: null },
]
const CHECKLIST = [{ id: 'c1', task_id: 't1', title: 'Simular parcelas', done: true, position: 1, created_at: '2026-11-01' }, { id: 'c2', task_id: 't1', title: 'Enviar proposta', done: false, position: 2, created_at: '2026-11-01' }]
const HISTORY = [
  { id: 'h1', field: 'priority', old_value: 'alta', new_value: 'urgente', changed_by: 'u1', created_at: '2026-11-08T10:00:00Z' },
  { id: 'h0', field: 'created', old_value: null, new_value: 'Ligar', changed_by: ME, created_at: '2026-11-01T10:00:00Z' },
]

// Tela de notebook comum; a de 720px do padrão corta a base das colunas no meio do arraste.
test.use({ viewport: { width: 1440, height: 1000 } })

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const idsOf = url => {
  const raw = new URL(url).searchParams.get('id') || ''
  if (raw.startsWith('eq.')) return [raw.slice(3)]
  if (raw.startsWith('in.(')) return raw.slice(4, -1).split(',').map(s => s.replace(/"/g, ''))
  return []
}

async function mockBackend(page, { role = 'admin' } = {}) {
  const calls = { moves: [], taskPatches: [], stagePosts: [], checklistPosts: [], commentPosts: [], seeded: 0 }
  await page.addInitScript(r => {
    try {
      window.localStorage.setItem('surgimetrics_onboarded', 'true')
      window.localStorage.setItem('surgimetrics_e2e_role', r)
    } catch { /* ignore */ }
  }, role)
  await page.route('**/rest/v1/rpc/clinic_team', route => route.fulfill(json([
    { user_id: ME, member_email: 'e2e@surgimetrics.local', role },
    { user_id: 'u1', member_email: 'lunara@clinica.com', role: 'gestao' },
  ])))
  await page.route('**/rest/v1/rpc/task_ensure_default_stages', route => { calls.seeded++; return route.fulfill(json(0)) })
  await page.route('**/rest/v1/rpc/task_move', route => { calls.moves.push(route.request().postDataJSON()); return route.fulfill(json(1)) })
  await page.route('**/rest/v1/task_stages*', route => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill(json(STAGES))
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      calls.stagePosts.push(body)
      return route.fulfill(json({ id: 's-new', is_default: false, seed_key: null, archived_at: null, created_at: new Date().toISOString(), ...body }, 201))
    }
    return route.continue()
  })
  await page.route('**/rest/v1/tasks*', route => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill(json(TASKS))
    if (req.method() === 'PATCH') {
      calls.taskPatches.push({ ids: idsOf(req.url()), body: req.postDataJSON() })
      return route.fulfill(json(idsOf(req.url()).map(id => ({ id }))))
    }
    return route.continue()
  })
  await page.route('**/rest/v1/task_checklist_items*', route => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() === 'GET') {
      if (url.searchParams.get('select') === 'task_id,done') return route.fulfill(json(CHECKLIST.map(c => ({ task_id: c.task_id, done: c.done }))))
      const t = url.searchParams.get('task_id')?.slice(3)
      return route.fulfill(json(CHECKLIST.filter(c => c.task_id === t)))
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      calls.checklistPosts.push(body)
      return route.fulfill(json({ id: `c-new-${calls.checklistPosts.length}`, done: false, created_at: new Date().toISOString(), ...body }, 201))
    }
    return route.continue()
  })
  await page.route('**/rest/v1/task_comments*', route => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill(json([]))
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      calls.commentPosts.push(body)
      return route.fulfill(json({ id: `k-${calls.commentPosts.length}`, created_at: new Date().toISOString(), parent_id: null, mentions: [], ...body, author_id: ME }, 201))
    }
    return route.continue()
  })
  await page.route('**/rest/v1/task_history*', route => route.fulfill(json(HISTORY)))
  for (const t of ['opportunities', 'opportunity_notes', 'workspace_preferences', 'procedures']) {
    await page.route(`**/rest/v1/${t}*`, route => (route.request().method() === 'GET' ? route.fulfill(json([])) : route.continue()))
  }
  return calls
}

async function openKanban(page) {
  await page.goto('/app/tarefas')
  await page.getByTestId('task-view-kanban').click()
  await expect(page.getByTestId('task-kanban')).toBeVisible()
}
const column = (page, key) => page.getByTestId(`task-column-${key}`)
const card = (page, id) => page.locator(`[data-testid="task-card"][data-task-id="${id}"]`)

test('kanban: 4 colunas configuráveis com contagem e cards compactos com as informações', async ({ page }) => {
  const calls = await mockBackend(page)
  await openKanban(page)
  expect(calls.seeded).toBe(1)
  await expect(page.locator('[data-testid^="task-column-"][data-stage-id]')).toHaveCount(4)
  await expect(column(page, 'todo').getByTestId('task-column-count')).toHaveText('1')
  await expect(column(page, 'doing').getByTestId('task-column-count')).toHaveText('1')
  await expect(column(page, 'waiting').getByTestId('task-column-count')).toHaveText('1')
  await expect(column(page, 'done').getByTestId('task-column-count')).toHaveText('1')

  const c1 = card(page, 't1')
  await expect(c1).toContainText('Ligar para Mariana sobre parcelamento')
  await expect(c1.getByTestId('task-card-patient')).toContainText('Mariana Costa')
  await expect(c1).toContainText('Rinoplastia')
  await expect(c1.getByTestId('task-priority')).toHaveText('Urgente')
  await expect(c1.getByTestId('task-due')).toContainText('ontem')
  await expect(c1.getByTestId('task-checklist-progress')).toHaveText('1/2')
  await expect(c1).toContainText('Ligar')
  // Card compacto: bem menor que os cards antigos (~ 90px+).
  const box = await c1.boundingBox()
  expect(box.height).toBeLessThan(110)
})

test('kanban: arrastar para outra coluna chama task_move (o banco ajusta o status) e reflete na hora', async ({ page }) => {
  const calls = await mockBackend(page)
  await openKanban(page)
  // Solta na área vazia da coluna (no fim da lista).
  const bottom = async loc => { const b = await loc.boundingBox(); return { x: b.width / 2, y: b.height - 12 } }
  await card(page, 't1').dragTo(column(page, 'doing'), { targetPosition: await bottom(column(page, 'doing')) })
  await expect.poll(() => calls.moves.length).toBe(1)
  expect(calls.moves[0]).toEqual({ p_task_id: 't1', p_stage_id: 's-doing', p_ordered_ids: ['t2', 't1'] })
  await expect(column(page, 'doing').getByTestId('task-column-count')).toHaveText('2')
  await expect(column(page, 'todo').getByTestId('task-column-count')).toHaveText('0')

  // Reordenar dentro da coluna: só a ordem (stage nulo).
  await card(page, 't1').dragTo(card(page, 't2'))
  await expect.poll(() => calls.moves.length).toBe(2)
  expect(calls.moves[1]).toEqual({ p_task_id: 't1', p_stage_id: null, p_ordered_ids: ['t1', 't2'] })
  await expect(column(page, 'doing').getByTestId('task-card').first()).toHaveAttribute('data-task-id', 't1')

  // Concluir pelo quadro: arrastar para Concluída.
  await card(page, 't2').dragTo(column(page, 'done'), { targetPosition: await bottom(column(page, 'done')) })
  await expect.poll(() => calls.moves.length).toBe(3)
  expect(calls.moves[2].p_stage_id).toBe('s-done')
  await expect(column(page, 'done').getByTestId('task-column-count')).toHaveText('2')
})

test('kanban: gestão cria coluna nova com cor e status base', async ({ page }) => {
  const calls = await mockBackend(page)
  await openKanban(page)
  await page.getByTestId('task-stage-new').click()
  await page.getByTestId('task-stage-label').fill('Revisão médica')
  await page.getByRole('radio', { name: 'Cor #e2445c' }).click()
  await page.getByTestId('task-stage-base').selectOption('aguardando')
  await page.getByTestId('task-stage-save').click()
  await expect.poll(() => calls.stagePosts.length).toBe(1)
  expect(calls.stagePosts[0]).toMatchObject({ label: 'Revisão médica', color: '#e2445c', base_status: 'aguardando', position: 5 })
  await expect(page.getByRole('region', { name: 'Coluna Revisão médica' })).toBeVisible()
})

test('equipe não vê os controles de configurar colunas', async ({ page }) => {
  await mockBackend(page, { role: 'equipe' })
  await openKanban(page)
  await expect(page.getByTestId('task-stage-new')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Opções da coluna A fazer' })).toHaveCount(0)
})

test('filtros combinados valem no Kanban e na Tabela, com contador e limpar', async ({ page }) => {
  await mockBackend(page)
  await openKanban(page)
  await page.getByRole('button', { name: 'Todas', exact: true }).click()
  await page.getByTestId('task-filter-button').click()
  const panel = page.getByTestId('task-filter-panel')
  await panel.getByTestId('task-filter-priority-urgente').click()
  await panel.getByTestId('task-filter-priority-alta').click()
  await panel.getByTestId('task-filter-due-overdue').click()
  await expect(page.getByTestId('task-filter-button-count')).toHaveText('2')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('task-card')).toHaveCount(1)
  await expect(card(page, 't1')).toBeVisible()

  // Mesmos filtros na Tabela.
  await page.getByTestId('task-view-table').click()
  await expect(page.getByTestId('task-row')).toHaveCount(1)
  await page.getByTestId('task-filter-clear').click()
  await expect(page.getByTestId('task-filter-button-count')).toHaveCount(0)
  await expect(page.getByTestId('task-row')).toHaveCount(4)
})

test('tabela: edição na célula, agrupamento e edição em massa', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/tarefas')
  await page.getByRole('button', { name: 'Todas', exact: true }).click()
  const rowT2 = page.locator('[data-testid="task-row"][data-task-id="t2"]')

  // Prioridade na célula.
  await rowT2.getByTestId('task-cell-priority').click()
  await page.getByRole('dialog', { name: 'Prioridade' }).getByRole('option', { name: 'Média' }).click()
  await expect.poll(() => calls.taskPatches.length).toBe(1)
  expect(calls.taskPatches[0]).toMatchObject({ ids: ['t2'], body: { priority: 'media' } })

  // Status pela célula → grava a coluna (stage_id); o banco ajusta o status.
  await rowT2.getByTestId('task-cell-status').click()
  await page.getByRole('dialog', { name: 'Status da tarefa' }).getByRole('option', { name: 'Aguardando' }).click()
  await expect.poll(() => calls.taskPatches.length).toBe(2)
  expect(calls.taskPatches[1].body).toMatchObject({ stage_id: 's-wait' })

  // Agrupar por prioridade.
  await page.getByTestId('task-group-button').click()
  await page.getByRole('menuitem', { name: 'Prioridade' }).click()
  await expect(page.getByTestId('task-group-urgente')).toBeVisible()
  await expect(page.getByTestId('task-group-media')).toContainText('Enviar orçamento revisado')

  // Seleção múltipla + responsável em massa (uma escrita para todas).
  await page.locator('[data-testid="task-row"][data-task-id="t1"]').getByTestId('task-row-select').check()
  await rowT2.getByTestId('task-row-select').check()
  await expect(page.getByTestId('task-bulk-bar')).toContainText('2 selecionadas')
  await page.getByTestId('task-bulk-responsible').click()
  await page.getByRole('dialog', { name: 'Atribuir responsável' }).getByRole('menuitem', { name: /lunara/ }).click()
  await expect.poll(() => calls.taskPatches.length).toBe(3)
  expect(calls.taskPatches[2].ids.sort()).toEqual(['t1', 't2'])
  expect(calls.taskPatches[2].body).toMatchObject({ assigned_user_id: 'u1' })
})

test('tabela: ocultar e reordenar colunas fica salvo', async ({ page }) => {
  // Viewport larga: sem rolagem horizontal no meio do arraste do cabeçalho.
  await page.setViewportSize({ width: 1900, height: 900 })
  await mockBackend(page)
  await page.goto('/app/tarefas')
  await page.getByTestId('task-columns-button').click()
  await page.getByRole('dialog', { name: 'Mostrar ou ocultar colunas' }).getByLabel('Categoria').uncheck()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('task-col-category').first()).toHaveCount(0)
  await page.getByTestId('task-col-due').first().dragTo(page.getByTestId('task-col-status').first())
  const order = await page.locator('[data-testid="task-group-s-todo"] [role="columnheader"]').evaluateAll(els => els.map(e => e.dataset.testid))
  expect(order.slice(0, 3)).toEqual(['task-col-title', 'task-col-due', 'task-col-status'])
  await page.reload()
  await expect(page.getByTestId('task-col-category')).toHaveCount(0)
})

test('painel lateral: editar, subtarefas, comentário com menção e histórico, sem sair do Kanban', async ({ page }) => {
  const calls = await mockBackend(page)
  await openKanban(page)
  await card(page, 't1').click()
  const drawer = page.getByTestId('task-drawer')
  await expect(drawer).toBeVisible()
  await expect(page.getByTestId('task-kanban')).toBeVisible()

  await drawer.getByTestId('task-drawer-title').fill('Ligar para Mariana (parcelamento em 10x)')
  await drawer.getByTestId('task-drawer-title').press('Enter')
  await expect.poll(() => calls.taskPatches.length).toBe(1)
  expect(calls.taskPatches[0].body).toMatchObject({ title: 'Ligar para Mariana (parcelamento em 10x)' })
  await expect(card(page, 't1')).toContainText('parcelamento em 10x')

  await drawer.getByTestId('task-drawer-description').fill('Paciente prefere contato à tarde.')
  await drawer.getByTestId('task-drawer-priority').focus()
  await expect.poll(() => calls.taskPatches.length).toBe(2)
  expect(calls.taskPatches[1].body).toMatchObject({ description: 'Paciente prefere contato à tarde.' })

  // Subtarefas: progresso e o contador do card acompanham.
  await expect(drawer.getByTestId('task-checklist-item')).toHaveCount(2)
  await drawer.getByTestId('task-checklist-new').fill('Confirmar data da cirurgia')
  await drawer.getByTestId('task-checklist-new').press('Enter')
  await expect.poll(() => calls.checklistPosts.length).toBe(1)
  expect(calls.checklistPosts[0]).toMatchObject({ task_id: 't1', title: 'Confirmar data da cirurgia', position: 3 })
  await expect(card(page, 't1').getByTestId('task-checklist-progress')).toHaveText('1/3')

  // Comentário com @menção (mesmo componente das Atualizações do CRM).
  await drawer.getByTestId('task-tab-comments').click()
  const input = drawer.getByTestId('opp-update-input')
  await input.pressSequentially('@lun')
  await input.press('Enter')
  await input.pressSequentially('pode confirmar o valor?')
  await drawer.getByTestId('opp-update-input-send').click()
  await expect.poll(() => calls.commentPosts.length).toBe(1)
  expect(calls.commentPosts[0]).toMatchObject({ task_id: 't1', body: '@lunara pode confirmar o valor?', mentions: ['u1'] })

  await drawer.getByTestId('task-tab-history').click()
  await expect(drawer.getByTestId('task-history')).toContainText('lunara Prioridade: Alta → Urgente')

  await drawer.getByTestId('task-drawer-close').click()
  await expect(drawer).toHaveCount(0)
})
