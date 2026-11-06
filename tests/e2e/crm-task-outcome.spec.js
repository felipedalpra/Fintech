import { expect, test } from '@playwright/test'

const HOJE = new Date().toISOString().slice(0, 10)
const TASK_ID = 'aaaaaaaa-0000-4000-8000-000000000001'

const TASKS = [{
  id:TASK_ID, title:'Ligar sobre o orçamento', due_date:HOJE, due_time:'09:30',
  task_type:'ligar', status:'pendente', outcome:null, assigned_user_id:null,
  done_at:null, created_at:HOJE, opportunity_id:null, patient_id:'p1',
  patients:{ full_name:'Katia Z Martins', phone:'+55 61 99999-0000' }, opportunities:null,
}]

async function mock(page, { onAttempt, onTaskPatch } = {}) {
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/**', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }))
  await page.route('**/rest/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path.endsWith('/task_attempts') && request.method() === 'POST') {
      onAttempt?.(request.postDataJSON())
      return route.fulfill({ status:201, contentType:'application/json', body:'[]' })
    }
    if (path.endsWith('/tasks') && request.method() === 'PATCH') {
      onTaskPatch?.(request.postDataJSON())
      return route.fulfill({ status:200, contentType:'application/json', body:'[]' })
    }
    let body = []
    if (path.endsWith('/tasks') && request.method() === 'GET') body = TASKS
    if (path.endsWith('/rpc/clinic_team')) body = []
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/0' }, body:JSON.stringify(body) })
  })
}

test('a tarefa mostra tipo, hora e atalho de WhatsApp', async ({ page }) => {
  await mock(page)
  await page.goto('/app/tarefas')

  await expect(page.getByText('Ligar sobre o orçamento')).toBeVisible()
  await expect(page.getByText('Ligar', { exact:true })).toBeVisible()
  await expect(page.getByText('09:30', { exact:false })).toBeVisible()

  // O atalho leva direto para a conversa, sem o número ser digitado à mão.
  const whats = page.getByTestId(`task-whatsapp-${TASK_ID}`)
  await expect(whats).toHaveAttribute('href', 'https://wa.me/5561999990000')
})

test('"não atendeu" registra a tentativa e MANTÉM a tarefa na fila', async ({ page }) => {
  const attempts = []
  const patches = []
  await mock(page, { onAttempt:body => attempts.push(body), onTaskPatch:body => patches.push(body) })
  await page.goto('/app/tarefas')

  await page.getByTestId(`task-outcome-${TASK_ID}`).click()
  await page.getByRole('button', { name:/Não atendeu/ }).click()

  await expect(page.getByText('tentativa registrada · segue pendente')).toBeVisible()
  expect(attempts).toHaveLength(1)
  expect(attempts[0]).toMatchObject({ task_id:TASK_ID, outcome:'nao_atendeu' })
  // A tarefa NÃO pode ter sido encerrada: o trabalho continua.
  expect(patches).toEqual([])
  await expect(page.getByText('Ligar sobre o orçamento')).toBeVisible()
})

test('"atendeu" registra a tentativa e encerra a tarefa', async ({ page }) => {
  const attempts = []
  const patches = []
  await mock(page, { onAttempt:body => attempts.push(body), onTaskPatch:body => patches.push(body) })
  await page.goto('/app/tarefas')

  await page.getByTestId(`task-outcome-${TASK_ID}`).click()
  await page.getByRole('button', { name:/Atendeu/ }).click()

  await expect.poll(() => patches.length, { timeout:5000 }).toBe(1)
  expect(attempts[0]).toMatchObject({ outcome:'atendeu' })
  // A tentativa é gravada ANTES de encerrar: histórico não se perde se o update falhar.
  expect(patches[0]).toMatchObject({ status:'feita', outcome:'atendeu' })
})

test('o menu avisa, antes do clique, qual desfecho encerra a tarefa', async ({ page }) => {
  await mock(page)
  await page.goto('/app/tarefas')
  await page.getByTestId(`task-outcome-${TASK_ID}`).click()

  const menu = page.getByRole('button', { name:/Não atendeu/ })
  await expect(menu).toContainText('segue')
  await expect(page.getByRole('button', { name:/^Atendeu/ })).toContainText('encerra')
})

test('a visão kanban também abre o desfecho — foi onde a tela quebrou em produção', async ({ page }) => {
  // Regressão real (05/11/2026): KanbanColumn usava onOutcome sem recebê-lo, e a página inteira
  // caía com "onOutcome is not defined" para quem tinha o kanban selecionado. O e2e anterior só
  // exercitava a lista, que é o padrão — por isso passou verde com a tela quebrada.
  const attempts = []
  await mock(page, { onAttempt:body => attempts.push(body) })
  await page.goto('/app/tarefas')

  await page.getByRole('button', { name:'Kanban' }).click()
  await expect(page.getByText('A fazer')).toBeVisible()
  await expect(page.getByText('Ligar sobre o orçamento')).toBeVisible()

  await page.getByTestId(`task-outcome-${TASK_ID}`).click()
  await page.getByRole('button', { name:/Não atendeu/ }).click()
  // Esperar a requisição sair: afirmar logo após o clique já me enganou nesta mesma sessão.
  await expect.poll(() => attempts.length, { timeout:5000 }).toBe(1)
  await expect(page.getByText('tentativa registrada · segue pendente')).toBeVisible()
})
