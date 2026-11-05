import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/**', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"configured":false,"connected":false}' }))
})

test('equipe não recebe dados ou ações financeiras na interface', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_e2e_role', 'equipe'))
  await page.goto('/app/meu-dia')

  await expect(page.getByRole('button', { name:'Financeiro', exact:true })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Clínico', exact:true })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Configurações', exact:true })).toHaveCount(0)
  await expect(page.getByText('Qualidade financeira', { exact:true })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Alertas', exact:true })).toHaveCount(0)
  await expect(page.getByTitle('Abrir copiloto')).toHaveCount(0)

  // Espera o perfil resolver de verdade. Antes, as asserções negativas passavam durante o
  // loading e a tela mudava para admin logo depois, produzindo falso positivo de permissão.
  await expect(page.getByText('Cadastrar primeiro contato', { exact:true })).toBeVisible()
  await expect(page.getByRole('button', { name:'Financeiro', exact:true })).toHaveCount(0)
  await expect(page.getByText('Revisar plano de contas', { exact:true })).toHaveCount(0)
  await expect(page.getByText('Registrar primeiro lançamento', { exact:true })).toHaveCount(0)

  await page.getByTitle('Lançamento rápido').click()
  await expect(page.getByRole('button', { name:/Nova consulta$/ })).toBeVisible()
  await expect(page.getByRole('button', { name:/Nova cirurgia$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name:/Nova despesa$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name:/Nova receita$/ })).toHaveCount(0)
})

test('equipe grava uma consulta sem esbarrar na tabela de indicadores protegida por RLS', async ({ page }) => {
  // Regressão real (Jonas, 04/11/2026): o autosave gravava finance_indicator_inputs em TODO save,
  // mesmo sem nenhuma mudança de indicador. A RLS dessa tabela exige papel financeiro, então o
  // perfil Equipe recebia "new row violates row-level security policy" e PERDIA a gravação
  // inteira — inclusive trabalho que nada tem a ver com indicadores financeiros.
  const indicatorWrites = []
  const writes = []
  let rowSeq = 0
  // O mock ECOA as linhas gravadas: o save exige read-back de cada upsert, e devolver []
  // faria a gravação morrer na primeira tabela, antes de chegar nos indicadores — o teste
  // passaria mesmo com o bug presente.
  await page.route('**/rest/v1/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const isWrite = request.method() !== 'GET'
    if (isWrite) writes.push(path)
    if (isWrite && path.endsWith('/finance_indicator_inputs')) {
      indicatorWrites.push(request.method())
      // Reproduz o banco real: a RLS recusa a escrita para quem não tem papel financeiro.
      return route.fulfill({
        status:403,
        contentType:'application/json',
        body:JSON.stringify({ code:'42501', message:'new row violates row-level security policy for table "finance_indicator_inputs"' }),
      })
    }
    // Eco com id: o save confere o read-back de cada escrita. Devolver [] (ou linha sem id)
    // faria a gravação morrer antes de chegar nos indicadores, e o teste passaria com o bug.
    const sent = isWrite ? (request.postDataJSON() || []) : []
    const rows = (Array.isArray(sent) ? sent : [sent]).map((row, index) => ({
      ...row,
      id:row?.id || `00000000-0000-4000-8000-${String(++rowSeq).padStart(12, '0')}${index ? '' : ''}`,
    }))
    return route.fulfill({
      status:200,
      contentType:'application/json',
      headers:{ 'content-range':'0-0/0' },
      body:JSON.stringify(isWrite ? rows : []),
    })
  })

  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_e2e_role', 'equipe'))
  await page.goto('/app/consultations')

  await page.getByRole('button', { name:'+ Nova Consulta' }).click()
  await page.getByPlaceholder('Apelido, código ou observação').fill('Consulta E2E equipe')
  await page.getByRole('button', { name:'Salvar consulta' }).click()

  await expect(page.getByText('Consulta E2E equipe')).toBeVisible()

  // ESPERAR a gravação chegar ao fim antes de concluir qualquer coisa. Sem isto o teste afirmava
  // "nenhuma escrita" antes de o save sair, e passava mesmo com o bug presente.
  // `financial_entries` é gravado DEPOIS do passo dos indicadores (financeStore.saveData): se a
  // tabela protegida fosse tocada, o 403 abortaria o save e esta escrita nunca aconteceria.
  await expect.poll(() => writes.some(path => path.endsWith('/financial_entries')), { timeout:15_000 })
    .toBe(true)

  // É exatamente este o estado que o Jonas via: erro de gravação no lugar da confirmação.
  await expect(page.getByText('Erro ao salvar', { exact:true })).toHaveCount(0)
  await expect(page.getByText('não foram confirmadas no banco', { exact:false })).toHaveCount(0)
  expect(indicatorWrites).toEqual([])
})
