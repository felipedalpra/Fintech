import { expect, test } from '@playwright/test'

const PROCEDURE_ID = '11111111-1111-4111-8111-111111111111'
const PATIENT_ID = '22222222-2222-4222-8222-222222222222'
const SURGERY_ID = '33333333-3333-4333-8333-333333333333'
const CONSULTATION_ID = '44444444-4444-4444-8444-444444444444'

function isoToday() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

async function mockCalendarData(page) {
  const date = isoToday()
  let payload = {
    procedures:[{ id:PROCEDURE_ID, name:'Rinoplastia', price:18000, durationHours:3 }],
    products:[], productSales:[], productPurchases:[], extraRevenues:[], expenses:[], assets:[], liabilities:[], goals:[], chartAccounts:[],
    surgeries:[{ id:SURGERY_ID, patient:'Ana Costa', patientId:PATIENT_ID, procedureId:PROCEDURE_ID, totalValue:18000, date, competenceDate:date, dueDate:date, startTime:'09:00', durationMinutes:180, paymentStatus:'pendente', paymentMethod:'pix' }],
    consultations:[{ id:CONSULTATION_ID, patient:'Ana Costa', patientId:PATIENT_ID, date, competenceDate:date, dueDate:date, startTime:'09:30', durationMinutes:60, consultationType:'retorno', value:300, paymentStatus:'pendente', paymentMethod:'pix', paymentType:'particular' }],
  }

  await page.addInitScript(() => {
    window.localStorage.setItem('surgimetrics_onboarded', 'true')
    window.localStorage.removeItem('surgimetrics_calendar_view')
  })

  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ json:{ configured:false, connected:false, links:{} } }))
  await page.route('**/rest/v1/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const table = url.pathname.split('/').pop()
    const method = request.method()

    if (table === 'procedures' && url.searchParams.get('select') === 'id') {
      return route.fulfill({ status:404, json:{ code:'42P01', message:'legacy mode for e2e' } })
    }
    if (table === 'user_finance_data') {
      if (method === 'GET') return route.fulfill({ json:[{ payload }] })
      const body = request.postDataJSON()
      if (body?.payload) payload = body.payload
      return route.fulfill({ json:[body] })
    }
    if (table === 'patients') {
      return route.fulfill({ json:[{ id:PATIENT_ID, full_name:'Ana Costa', cpf:null, phone:'5511999999999', active:true }] })
    }
    return route.fulfill({ json:[] })
  })

  return { getPayload:() => payload }
}

test('alterna visualizações, cria atendimento e mantém após recarregar', async ({ page }) => {
  const store = await mockCalendarData(page)
  await page.goto('/app/calendar')

  await expect(page.getByTestId('calendar-month-view')).toBeVisible()
  await expect(page.getByText('Ana Costa', { exact:true }).first()).toBeVisible()
  await expect(page.getByText(/atendimentos com conflito/)).toBeVisible()

  const viewSwitch = page.getByRole('group', { name:'Visualização da agenda' })
  await viewSwitch.getByRole('button', { name:'Semana', exact:true }).click()
  await expect(page.getByTestId('calendar-week-view')).toBeVisible()
  await viewSwitch.getByRole('button', { name:'Dia', exact:true }).click()
  await expect(page.getByTestId('calendar-day-view')).toBeVisible()
  await viewSwitch.getByRole('button', { name:'Agenda', exact:true }).click()
  await expect(page.getByTestId('calendar-agenda-view')).toBeVisible()

  await page.getByRole('button', { name:'Criar', exact:true }).click()
  await page.getByRole('combobox').first().selectOption(PATIENT_ID)
  await page.locator('input[type="time"]').fill('14:30')
  await page.getByRole('button', { name:'Salvar e preencher depois' }).click()
  await expect(page.getByText('Atendimento criado e salvo.')).toBeVisible()
  await expect.poll(() => store.getPayload().consultations.length).toBe(2)

  await page.reload()
  await page.getByRole('group', { name:'Visualização da agenda' }).getByRole('button', { name:'Agenda', exact:true }).click()
  await expect(page.getByText('Ana Costa', { exact:true })).toHaveCount(3)
})

test('salva financeiro pela agenda no mesmo atendimento e mantém após recarregar', async ({ page }) => {
  const store = await mockCalendarData(page)
  await page.goto('/app/calendar')

  await page.getByRole('button', { name:'Criar', exact:true }).click()
  await page.getByRole('combobox').first().selectOption(PATIENT_ID)
  await page.locator('input[type="time"]').fill('15:30')
  await page.getByRole('button', { name:'Adicionar informações financeiras' }).click()

  const finance = page.getByTestId('calendar-financial-fields')
  const valueInput = finance.getByText('Valor da consulta', { exact:true }).locator('..').locator('input')
  await valueInput.fill('450')
  await valueInput.press('Tab')
  await finance.locator('select').filter({ hasText:'PIXCartãoDinheiroBoletoTransferência' }).selectOption('cartao')
  await finance.locator('select').filter({ hasText:'PendentePagoGlosadoCancelado' }).selectOption('pago')
  await finance.locator('input[type="date"]').last().fill(isoToday())
  await page.getByRole('button', { name:'Criar atendimento' }).click()

  await expect.poll(() => store.getPayload().consultations.length).toBe(2)
  const created = store.getPayload().consultations.at(-1)
  expect(created).toMatchObject({ value:450, paymentMethod:'cartao', paymentStatus:'pago', paymentDate:isoToday() })

  await page.reload()
  await page.getByRole('group', { name:'Visualização da agenda' }).getByRole('button', { name:'Agenda', exact:true }).click()
  await expect(page.locator('.cal-agenda__value').getByText('R$ 450,00')).toBeVisible()

  await page.locator('.cal-agenda__event').filter({ hasText:'R$ 450,00' }).click()
  await page.getByRole('button', { name:'Ver informações financeiras' }).click()
  const editedValue = page.getByTestId('calendar-financial-fields').getByText('Valor da consulta', { exact:true }).locator('..').locator('input')
  await editedValue.click()
  await editedValue.press('ControlOrMeta+A')
  await editedValue.fill('500')
  await editedValue.press('Tab')
  await page.getByRole('button', { name:'Salvar alterações' }).click()

  await expect.poll(() => store.getPayload().consultations.at(-1).value).toBe(500)
  expect(store.getPayload().consultations).toHaveLength(2)
  expect(store.getPayload().consultations.at(-1).id).toBe(created.id)
})

test('cadastra valor e custos de cirurgia pela agenda sem criar lançamento paralelo', async ({ page }) => {
  const store = await mockCalendarData(page)
  await page.goto('/app/calendar')

  await page.getByRole('button', { name:'Criar', exact:true }).click()
  await page.getByRole('button', { name:'Cirurgia', exact:true }).click()
  await page.getByRole('combobox').first().selectOption(PATIENT_ID)
  await page.getByRole('button', { name:'Adicionar informações financeiras' }).click()

  const finance = page.getByTestId('calendar-financial-fields')
  const totalInput = finance.getByText('Valor total da cirurgia', { exact:true }).locator('..').locator('input')
  await totalInput.fill('18000')
  await totalInput.press('Tab')
  const hospitalInput = finance.getByText('Custo hospital', { exact:true }).locator('..').locator('input')
  await hospitalInput.fill('3000')
  await hospitalInput.press('Tab')
  await page.getByRole('button', { name:'Criar atendimento' }).click()

  await expect.poll(() => store.getPayload().surgeries.length).toBe(2)
  expect(store.getPayload().surgeries.at(-1)).toMatchObject({
    patientId:PATIENT_ID,
    procedureId:PROCEDURE_ID,
    totalValue:18000,
    hospitalCost:3000,
    paymentStatus:'pendente',
  })
})

test('agenda mobile permite navegar e abrir um atendimento', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  await mockCalendarData(page)
  await page.goto('/app/calendar')

  await page.getByRole('group', { name:'Visualização da agenda' }).getByRole('button', { name:'Agenda', exact:true }).click()
  await expect(page.getByTestId('calendar-agenda-view')).toBeVisible()
  await page.getByText('Rinoplastia', { exact:false }).click()
  await expect(page.getByRole('heading', { name:'Editar atendimento' })).toBeVisible()
  await expect(page.getByRole('button', { name:'Salvar alterações' })).toBeVisible()
})
