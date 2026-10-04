import { expect, test } from '@playwright/test'

const CONNECTED = { configured:true, connected:true, needsReconnect:false, email:'medico@example.com', links:{} }

async function mockGoogleCalendar(page, { status, events = [] }) {
  const syncBodies = []
  await page.addInitScript(() => {
    window.localStorage.setItem('surgimetrics_onboarded', 'true')
  })
  await page.route(/\/api\/google\/calendar\?/, async route => {
    const action = new URL(route.request().url()).searchParams.get('action')
    if (action === 'status') return route.fulfill({ json:status })
    if (action === 'events') return route.fulfill({ json:{ events } })
    if (action === 'sync') {
      syncBodies.push(route.request().postDataJSON())
      return route.fulfill({ json:{ links:{}, deleted:[], errors:[] } })
    }
    if (action === 'connect') return route.fulfill({ json:{ url:'/app/calendar?google=connected' } })
    if (action === 'disconnect') return route.fulfill({ json:{ ok:true } })
    return route.fulfill({ status:404, json:{ error:'not found' } })
  })
  return syncBodies
}

function todayIso() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

test('mostra botao de conectar e confirma conexao ao voltar do Google', async ({ page }) => {
  await mockGoogleCalendar(page, { status:{ configured:true, connected:false, needsReconnect:false, email:'', links:{} } })
  await page.goto('/app/calendar')

  await expect(page.getByText('Conecte sua Google Agenda')).toBeVisible()
  await page.getByRole('button', { name:'Conectar Google Agenda' }).click()

  await expect(page.getByText('Google Agenda conectada com sucesso.')).toBeVisible()
  await expect(page).toHaveURL(/\/app\/calendar$/)
})

test('mostra Reconectar quando a conexao expirou', async ({ page }) => {
  await mockGoogleCalendar(page, { status:{ configured:true, connected:false, needsReconnect:true, email:'', links:{} } })
  await page.goto('/app/calendar')

  await expect(page.getByText('A conexão com a Google Agenda expirou')).toBeVisible()
  await expect(page.getByRole('button', { name:'Reconectar' })).toBeVisible()
})

test('mostra eventos do Google no calendario', async ({ page }) => {
  await mockGoogleCalendar(page, {
    status:CONNECTED,
    events:[{
      googleId:'g1', title:'Reunião de equipe', date:todayIso(), startTime:'10:00', durationMinutes:60,
      allDay:false, cancelled:false, recordType:'', recordId:'', linked:false, externalChange:false,
    }],
  })
  await page.goto('/app/calendar')

  await expect(page.getByText('Google Agenda conectada')).toBeVisible()
  await expect(page.getByText('medico@example.com', { exact:false })).toBeVisible()
  await expect(page.getByText('1 evento do Google')).toBeVisible()
})

test('envia consulta com horario para a Google Agenda ao salvar', async ({ page }) => {
  const syncBodies = await mockGoogleCalendar(page, { status:CONNECTED })
  await page.goto('/app/consultations')

  await page.getByRole('button', { name:'+ Nova Consulta' }).click()
  await page.getByPlaceholder('Use somente o dado mínimo necessário').fill('Maria da Silva')
  await page.locator('input[type="date"]').first().fill('2099-01-10')
  await page.locator('input[type="time"]').fill('14:30')
  await page.getByRole('button', { name:'Salvar consulta' }).click()

  await expect.poll(() => syncBodies.length, { timeout:8000 }).toBeGreaterThan(0)
  expect(syncBodies[0].upserts[0]).toMatchObject({
    type:'consultation',
    title:'Maria da Silva — Avaliação',
    date:'2099-01-10',
    startTime:'14:30',
    durationMinutes:60,
  })
})
