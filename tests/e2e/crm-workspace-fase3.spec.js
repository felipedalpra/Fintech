import { expect, test } from '@playwright/test'

// CRM Fase 3: Atualizações (comentários com resposta e @menção), visualizações iniciais e
// rodapé de resumo por grupo. Backend mockado por rota; cada teste confere o que foi ENVIADO.
const ME = 'e2e-user-id' // usuário do bypass de autenticação dos e2e (AuthContext)
const base = { tags: [], suggestion_status: 'none', procedure_id: null, probability: null, next_action: null, next_action_due: null, expected_surgery_date: null, custom_values: {} }
const OPPS = [
  { ...base, id: 'o1', title: 'Rinoplastia', stage: 'orcamento_enviado', status: 'aberto', value: 25000, source: 'Instagram', stage_entered_at: '2026-10-07T12:00:00Z', created_at: '2026-10-06T10:00:00Z', patient_id: 'p1', responsible_user_id: ME, patients: { full_name: 'Mariana Costa', phone: '61999990000' } },
  { ...base, id: 'o2', title: 'Mamoplastia', stage: 'orcamento_enviado', status: 'aberto', value: 15000, probability: 50, source: 'Google', stage_entered_at: '2026-10-09T12:00:00Z', created_at: '2026-10-08T10:00:00Z', patient_id: 'p2', responsible_user_id: 'u1', patients: { full_name: 'Bia Souza', phone: '' } },
  { ...base, id: 'o3', title: 'Lipo', stage: 'consulta_agendada', status: 'aberto', value: 9000, source: 'Instagram', stage_entered_at: '2026-10-01T12:00:00Z', created_at: '2026-09-20T10:00:00Z', patient_id: 'p3', responsible_user_id: ME, patients: { full_name: 'Carla Dias', phone: '' } },
]
const TASKS = [
  { id: 't1', opportunity_id: 'o3', patient_id: 'p3', title: 'Follow-up', status: 'pendente', due_date: '2099-01-10', assigned_user_id: null, created_at: '2026-10-03T10:00:00Z' },
  { id: 't2', opportunity_id: 'o1', patient_id: 'p1', title: 'Consulta', status: 'feita', due_date: '2026-10-01', assigned_user_id: null, created_at: '2026-10-01T10:00:00Z' },
]
const NOTES = [
  { id: 'n1', opportunity_id: 'o1', body: 'Paciente solicitou informações sobre parcelamento.', author_id: 'u1', parent_id: null, mentions: [], created_at: '2026-11-09T10:00:00Z' },
  { id: 'n2', opportunity_id: 'o1', body: 'Podemos oferecer as condições previstas no orçamento.', author_id: ME, parent_id: 'n1', mentions: [], created_at: '2026-11-09T10:05:00Z' },
]
const MENTION = { id: 'n9', opportunity_id: 'o2', body: '@e2e pode ligar para ela amanhã?', author_id: 'u1', mentions: [ME], created_at: new Date().toISOString(), opportunities: { title: 'Mamoplastia', patients: { full_name: 'Bia Souza' } } }
const VIEW_CONFIG = (filters, extra = {}) => ({ columns: [], groupBy: 'stage', groupOrder: [], collapsed: {}, sort: null, filters, ...extra })
const VIEWS = [
  { id: 'v1', owner_id: 'owner', name: 'Meus leads', scope: 'shared', view_type: 'table', position: 1, config: VIEW_CONFIG({ responsible: ['me'], status: 'aberto' }) },
  { id: 'v2', owner_id: 'owner', name: 'Follow-ups pendentes', scope: 'shared', view_type: 'table', position: 2, config: VIEW_CONFIG({ openTasks: true, status: 'aberto' }) },
  { id: 'v3', owner_id: 'owner', name: 'Orçamentos em negociação', scope: 'shared', view_type: 'table', position: 3, config: VIEW_CONFIG({ stage: ['orcamento_enviado'], status: 'aberto' }) },
]

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function mockBackend(page, { role = 'equipe' } = {}) {
  const calls = { notePosts: [], viewPatches: [], ensureViews: 0 }
  await page.addInitScript(r => {
    try {
      window.localStorage.setItem('surgimetrics_onboarded', 'true')
      window.localStorage.setItem('surgimetrics_e2e_role', r)
    } catch { /* ignore */ }
  }, role)
  await page.route('**/rest/v1/rpc/clinic_team', route => route.fulfill(json([
    { user_id: 'u1', member_email: 'lunara@clinica.com', role: 'gestao' },
    { user_id: ME, member_email: 'e2e@surgimetrics.local', role },
  ])))
  await page.route('**/rest/v1/rpc/crm_last_contact', route => route.fulfill(json([])))
  await page.route('**/rest/v1/rpc/crm_ensure_default_views', route => { calls.ensureViews++; return route.fulfill(json(0)) })
  await page.route('**/rest/v1/procedures*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/opportunities*', route => (route.request().method() === 'GET' ? route.fulfill(json(OPPS)) : route.continue()))
  await page.route('**/rest/v1/tasks*', route => (route.request().method() === 'GET' ? route.fulfill(json(TASKS)) : route.continue()))
  await page.route('**/rest/v1/crm_views*', route => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill(json(VIEWS))
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON()
      const id = new URL(req.url()).searchParams.get('id')?.slice(3)
      calls.viewPatches.push({ id, body })
      return route.fulfill(json([{ ...VIEWS.find(v => v.id === id), ...body }]))
    }
    return route.continue()
  })
  await page.route('**/rest/v1/opportunity_notes*', route => {
    const req = route.request()
    const url = new URL(req.url())
    if (req.method() === 'GET') {
      if (url.searchParams.get('mentions')) return route.fulfill(json([MENTION]))
      const opp = url.searchParams.get('opportunity_id')
      if (opp?.startsWith('eq.')) return route.fulfill(json(NOTES.filter(n => n.opportunity_id === opp.slice(3))))
      return route.fulfill(json(NOTES.map(n => ({ opportunity_id: n.opportunity_id }))))
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      calls.notePosts.push(body)
      return route.fulfill(json({ id: `n-new-${calls.notePosts.length}`, created_at: new Date().toISOString(), parent_id: null, mentions: [], ...body, author_id: ME }, 201))
    }
    return route.continue()
  })
  for (const t of ['crm_stage_settings', 'crm_custom_fields', 'opportunity_stage_history', 'whatsapp_messages']) {
    await page.route(`**/rest/v1/${t}*`, route => (route.request().method() === 'GET' ? route.fulfill(json([])) : route.continue()))
  }
  return calls
}

const row = (page, name) => page.getByTestId('crm-row').filter({ hasText: name })

test('atualizações: fio cronológico, nova atualização com @menção e resposta no fio', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/funnel')
  const mariana = row(page, 'Mariana Costa')
  await mariana.getByRole('button', { name: 'Abrir atualizações' }).click()

  const panel = page.getByTestId('opp-updates')
  await expect(panel.getByTestId('opp-update')).toHaveCount(1)
  await expect(panel.getByTestId('opp-update').first()).toContainText('lunara')
  await expect(panel.getByTestId('opp-update').first()).toContainText('parcelamento')
  await expect(panel.getByTestId('opp-update-reply')).toContainText('condições previstas')

  // @ abre a lista da equipe; Enter escolhe; a menção vai para o banco como id (não texto).
  const input = panel.getByTestId('opp-update-input')
  await input.fill('Perfeito, vou retornar amanhã. ')
  await input.press('End')
  await input.pressSequentially('@lun')
  await expect(page.getByTestId('mention-suggestions')).toContainText('@lunara')
  await input.press('Enter')
  await expect(input).toHaveValue('Perfeito, vou retornar amanhã. @lunara ')
  await panel.getByTestId('opp-update-input-send').click()
  await expect.poll(() => calls.notePosts.length).toBe(1)
  expect(calls.notePosts[0]).toMatchObject({ opportunity_id: 'o1', body: 'Perfeito, vou retornar amanhã. @lunara', mentions: ['u1'] })
  expect(calls.notePosts[0].parent_id).toBeUndefined()
  await expect(panel.getByTestId('opp-update')).toHaveCount(2)
  await expect(panel.getByTestId('opp-update').last()).toContainText('retornar amanhã')

  // Resposta fica no fio da atualização original.
  await panel.getByTestId('opp-update').first().getByRole('button', { name: 'Responder' }).click()
  await panel.getByTestId('opp-reply-input').fill('Combinado.')
  await panel.getByTestId('opp-reply-input-send').click()
  await expect.poll(() => calls.notePosts.length).toBe(2)
  expect(calls.notePosts[1]).toMatchObject({ opportunity_id: 'o1', body: 'Combinado.', parent_id: 'n1' })
  expect(calls.notePosts[1].mentions).toBeUndefined()
  await expect(panel.getByTestId('opp-update').first().getByTestId('opp-update-reply')).toHaveCount(2)

  // Contador da coluna acompanha (2 antigas + 2 novas), sem recarregar.
  await page.keyboard.press('Escape')
  await expect(mariana.getByRole('button', { name: 'Abrir atualizações' })).toContainText('4')
})

test('menção acende o sino e leva direto às Atualizações da oportunidade', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/app/funnel')
  // O sino do CRM foi unificado com o financeiro num botão só ("Notificações").
  await page.getByRole('button', { name: 'Notificações', exact: true }).click()
  const mention = page.getByTestId('crm-alert-mention')
  await expect(mention).toContainText('lunara mencionou você · Bia Souza')
  await mention.click()
  await expect(page.getByTestId('opp-updates')).toBeVisible()
  await expect(page).not.toHaveURL(/opp=/)
})

test('visualizações iniciais: mesmos registros, filtros por usuário, tarefa aberta e etapa', async ({ page }) => {
  const calls = await mockBackend(page)
  await page.goto('/app/funnel')
  await expect.poll(() => calls.ensureViews).toBe(1)
  const modes = page.getByRole('tablist', { name: 'Modos do CRM' })
  await expect(modes.getByRole('tab', { name: /Tabela/ })).toContainText('Cadastre, edite, filtre e compare todos os dados.')
  await expect(modes.getByRole('tab', { name: /Kanban/ })).toContainText('Mova oportunidades pelas etapas do funil.')
  await expect(modes.getByRole('tab', { name: /Agenda/ })).toContainText('Organize prazos, tarefas e próximos contatos.')
  const tabs = page.getByRole('tablist', { name: 'Visualizações do CRM' })

  await expect(tabs.getByRole('tab', { name: /Meus leads/ })).toContainText('Somente oportunidades abertas sob sua responsabilidade.')
  await expect(tabs.getByRole('tab', { name: /Follow-ups pendentes/ })).toContainText('Negociações abertas que ainda possuem tarefa a acompanhar.')
  await expect(tabs.getByRole('tab', { name: /Orçamentos em negociação/ })).toContainText('Propostas enviadas que continuam abertas para negociação.')

  await tabs.getByRole('tab', { name: /Meus leads/ }).click()
  await expect(page.getByTestId('crm-row')).toHaveCount(2)
  await expect(row(page, 'Mariana Costa')).toHaveCount(1)
  await expect(row(page, 'Carla Dias')).toHaveCount(1)

  await tabs.getByRole('tab', { name: /Follow-ups pendentes/ }).click()
  await expect(page.getByTestId('crm-row')).toHaveCount(1)
  await expect(row(page, 'Carla Dias')).toHaveCount(1)

  await tabs.getByRole('tab', { name: /Orçamentos em negociação/ }).click()
  await expect(page.getByTestId('crm-row')).toHaveCount(2)
  await expect(row(page, 'Carla Dias')).toHaveCount(0)
})

test('visualização: gestão torna uma compartilhada em pessoal (vira dona dela)', async ({ page }) => {
  const calls = await mockBackend(page, { role: 'admin' })
  await page.goto('/app/funnel?view=v-v3')
  await page.getByRole('button', { name: 'Opções da visualização Orçamentos em negociação' }).click()
  await page.getByText('Renomear / quem vê').click()
  await page.getByTestId('crm-view-scope-personal').check()
  await expect(page.getByTestId('crm-view-scope-personal')).toBeChecked()
  await page.getByTestId('crm-view-submit').click()
  await expect.poll(() => calls.viewPatches.length).toBe(1)
  expect(calls.viewPatches[0]).toMatchObject({ id: 'v3', body: { name: 'Orçamentos em negociação', scope: 'personal', owner_id: ME } })
})

test('rodapé do grupo: quantidade, soma, ponderado e status — respeita filtros', async ({ page }) => {
  await mockBackend(page)
  await page.goto('/app/funnel')
  const footer = page.getByTestId('crm-group-footer-orcamento_enviado')
  await expect(footer.getByTestId('crm-footer-count')).toHaveText('2')
  await expect(footer.getByTestId('crm-footer-sum')).toHaveText(/R\$\s?40\.000/)
  // 25.000 × 60% (etapa) + 15.000 × 50% (própria) = 22.500
  await expect(footer.getByTestId('crm-footer-weighted')).toHaveText(/R\$\s?22\.500/)
  await expect(footer.getByTestId('crm-footer-status')).toHaveText([/Orçamento Enviado\s*2/])

  // Filtro (busca) muda o rodapé na hora.
  await page.getByLabel('Buscar oportunidades').fill('Mariana')
  await expect(footer.getByTestId('crm-footer-count')).toHaveText('1')
  await expect(footer.getByTestId('crm-footer-sum')).toHaveText(/R\$\s?25\.000/)
  await expect(footer.getByTestId('crm-footer-weighted')).toHaveText(/R\$\s?15\.000/)
})
