import { expect, test } from '@playwright/test'

const HOJE = new Date().toISOString().slice(0, 10)
const TOTAL = 60

// 60 receitas no mês corrente: o período padrão da tela é o mês, então datas fixas sairiam do range.
const EXTRA_REVENUES = Array.from({ length:TOTAL }, (_, index) => ({
  id:`r${index + 1}`, user_id:'e2e-user-id',
  description:`Lançamento ${String(index + 1).padStart(3, '0')}`,
  category:'outras_receitas', value:100 + index,
  date:HOJE, received_date:HOJE, competence_date:HOJE, due_date:HOJE,
  status:'recebido', chart_account_id:null, origin_label:'',
}))

const SURGERIES = Array.from({ length:TOTAL }, (_, index) => ({
  id:`s${index + 1}`, user_id:'e2e-user-id', patient:`Paciente ${String(index + 1).padStart(3, '0')}`,
  procedure_id:null, date:HOJE, competence_date:HOJE, total_value:1000 + index,
  payment_status:'pago', payment_date:HOJE, payment_method:'pix', installment_count:1,
}))

async function mock(page, tables) {
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/**', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }))
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    const key = Object.keys(tables).find(name => path.endsWith(`/${name}`))
    return route.fulfill({
      status:200, contentType:'application/json', headers:{ 'content-range':'0-0/0' },
      body:JSON.stringify(key ? tables[key] : []),
    })
  })
}

test('Entradas mostra 25 por página e navega até o fim sem perder lançamento', async ({ page }) => {
  await mock(page, { extra_revenues:EXTRA_REVENUES })
  await page.goto('/app/finance')
  await page.getByRole('button', { name:'Entradas', exact:true }).click()

  const pager = page.getByTestId('entries-pager')
  await expect(pager).toBeVisible()
  await expect(pager.getByText('1–25 de 60 lançamentos')).toBeVisible()
  await expect(pager.getByText('Página 1 de 3')).toBeVisible()
  // Escopado ao pager da tabela de Entradas: a tela tem mais de uma tabela paginada, e clicar
  // no "Próxima" errado avançava outra lista enquanto esta ficava parada.
  await expect(pager.getByRole('button', { name:'Anterior' })).toBeDisabled()

  await pager.getByRole('button', { name:'Próxima' }).click()
  await expect(pager.getByText('26–50 de 60 lançamentos')).toBeVisible()

  await pager.getByRole('button', { name:'Próxima' }).click()
  await expect(pager.getByText('51–60 de 60 lançamentos')).toBeVisible()
  await expect(pager.getByRole('button', { name:'Próxima' })).toBeDisabled()

  // A última página traz o último lançamento — nada ficou escondido no caminho.
  await expect(page.getByText('Lançamento 060')).toBeVisible()
  await expect(page.getByText('Lançamento 001')).toHaveCount(0)
})

test('filtrar enquanto se está na página 3 não deixa a tela em branco', async ({ page }) => {
  await mock(page, { extra_revenues:EXTRA_REVENUES })
  await page.goto('/app/finance')
  await page.getByRole('button', { name:'Entradas', exact:true }).click()
  const pager = page.getByTestId('entries-pager')
  await pager.getByRole('button', { name:'Próxima' }).click()
  await pager.getByRole('button', { name:'Próxima' }).click()
  await expect(pager.getByText('Página 3 de 3')).toBeVisible()

  // Busca que sobra 1 resultado: a lista tem que aparecer, não uma página vazia.
  await page.getByPlaceholder('Paciente, descrição, categoria...').fill('Lançamento 007')
  await expect(page.getByText('Lançamento 007')).toBeVisible()
  // Um resultado só: a paginação some em vez de deixar a pessoa numa página 3 vazia.
  await expect(pager).toHaveCount(0)
  await expect(page.getByText('Lançamento 008')).toHaveCount(0)
})

test('ordenar por Valor usa o número, não o texto com R$', async ({ page }) => {
  await mock(page, { extra_revenues:EXTRA_REVENUES })
  await page.goto('/app/finance')
  await page.getByRole('button', { name:'Entradas', exact:true }).click()

  // Valores de 100 a 159: ordem crescente começa em 100, decrescente em 159.
  const valorHeader = page.getByRole('columnheader', { name:/Valor/ }).first()
  await valorHeader.click()
  await expect(page.getByText('Lançamento 001')).toBeVisible()
  await expect(page.getByText('Lançamento 060')).toHaveCount(0)

  await valorHeader.click()
  await expect(page.getByText('Lançamento 060')).toBeVisible()
  await expect(page.getByText('Lançamento 001')).toHaveCount(0)
})

test('Cirurgias também pagina em 25', async ({ page }) => {
  await mock(page, { surgeries:SURGERIES })
  await page.goto('/app/sales')

  const pager = page.getByTestId('surgeries-pager')
  await expect(pager).toBeVisible()
  await expect(pager.getByText('1–25 de 60 cirurgias')).toBeVisible()
  await pager.getByRole('button', { name:'Próxima' }).click()
  await expect(pager.getByText('26–50 de 60 cirurgias')).toBeVisible()
})
