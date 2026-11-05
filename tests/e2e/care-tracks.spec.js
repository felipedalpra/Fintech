import { expect, test } from '@playwright/test'

const TRACK_ID = 'cccccccc-0000-4000-8000-000000000001'
const TRACKS = [{ id:TRACK_ID, name:'Pós-operatório padrão', procedure_id:null, active:true, created_at:'2026-11-01T10:00:00Z' }]
const STEPS = [
  { id:'s3', track_id:TRACK_ID, offset_days:30, title:'Retorno D+30', task_type:'retorno', assigned_user_id:null, active:true, sort_order:1 },
  { id:'s1', track_id:TRACK_ID, offset_days:-7, title:'Conferir exames pré-op', task_type:'exames', assigned_user_id:null, active:true, sort_order:2 },
  { id:'s2', track_id:TRACK_ID, offset_days:1, title:'Como passou a noite', task_type:'whatsapp', assigned_user_id:null, active:true, sort_order:3 },
]

async function mock(page, { onInsert } = {}) {
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/**', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }))
  await page.route('**/rest/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'POST' && (path.endsWith('/care_tracks') || path.endsWith('/care_track_steps'))) {
      const body = request.postDataJSON()
      onInsert?.({ path, body })
      return route.fulfill({ status:201, contentType:'application/json', body:JSON.stringify([{ id:'novo', ...body }]) })
    }
    let body = []
    if (path.endsWith('/care_tracks')) body = TRACKS
    if (path.endsWith('/care_track_steps')) body = STEPS
    if (path.endsWith('/procedures')) body = [{ id:'proc-1', name:'Mamoplastia' }]
    if (path.endsWith('/rpc/clinic_team')) body = []
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/0' }, body:JSON.stringify(body) })
  })
}

test('a esteira aparece na ordem do cuidado, não na de cadastro', async ({ page }) => {
  await mock(page)
  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Esteiras de acompanhamento', exact:true }).click()

  const track = page.getByTestId(`care-track-${TRACK_ID}`)
  await expect(track).toBeVisible()
  // Cadastrados como D+30, D-7, D+1 — exibidos na sequência real do cuidado.
  const labels = await track.getByText(/^(D[-+]\d+|no dia)$/).allTextContents()
  expect(labels).toEqual(['D-7', 'D+1', 'D+30'])
})

test('a tela explica a âncora e que nada é criado para cirurgia passada', async ({ page }) => {
  await mock(page)
  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Esteiras de acompanhamento', exact:true }).click()

  await expect(page.getByText('ancorada na data da cirurgia', { exact:false })).toBeVisible()
  await expect(page.getByText('Nenhuma tarefa é criada para cirurgia que já passou', { exact:false })).toBeVisible()
  await expect(page.getByText('desativar uma esteira não apaga o que já foi gerado', { exact:false })).toBeVisible()
})

test('a clínica cria a própria esteira e seus passos', async ({ page }) => {
  const inserts = []
  await mock(page, { onInsert:item => inserts.push(item) })
  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Esteiras de acompanhamento', exact:true }).click()

  await page.getByLabel('Nome').fill('Pós-op de rinoplastia')
  await page.getByRole('button', { name:'Criar esteira' }).click()
  await expect.poll(() => inserts.length).toBe(1)
  expect(inserts[0].body).toMatchObject({ name:'Pós-op de rinoplastia' })

  await page.getByLabel('Dias').first().fill('-2')
  await page.getByLabel('Passo').first().fill('Confirmar jejum')
  await page.getByRole('button', { name:'Adicionar passo' }).first().click()
  await expect.poll(() => inserts.length).toBe(2)
  expect(inserts[1].body).toMatchObject({ offset_days:-2, title:'Confirmar jejum' })
})
