import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'

test('mostra todas as linhas, permite editar e só salva após aprovação', async ({ page }) => {
  const importedBatchSizes = []
  let sourceRecordCount = 0
  let genericLedgerWrites = 0
  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"connected":false}' }))
  await page.route('**/rest/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body = request.method() === 'GET' ? [] : (request.postDataJSON() || [])
    if (path.endsWith('/financial_import_batches') && request.method() === 'POST') {
      body = { ...body, id:'10000000-0000-4000-8000-000000000001', status:'creating', created_at:'2026-11-03T10:00:00Z' }
    }
    if (path.endsWith('/financial_import_batches') && request.method() === 'PATCH') {
      body = {
        id:'10000000-0000-4000-8000-000000000001',
        file_name:'retroativos.xlsx',
        file_hash:'a'.repeat(64),
        sheet_name:'Planilha1',
        line_count:188,
        status:body.status || 'reviewing',
        ready_at:body.ready_at || null,
        created_at:'2026-11-03T10:00:00Z',
      }
    }
    if (path.endsWith('/financial_import_lines') && request.method() === 'POST') {
      const rows = Array.isArray(body) ? body : [body]
      body = rows.map(row => {
        sourceRecordCount += 1
        return { ...row, source_id:`20000000-0000-4000-8000-${String(sourceRecordCount).padStart(12, '0')}`, archived_at:null }
      })
    }
    if (path.endsWith('/rpc/approve_financial_import_lines') && request.method() === 'POST') {
      const items = body.p_items || []
      importedBatchSizes.push(items.length)
      await new Promise(resolve => setTimeout(resolve, 180))
      body = items.map(item => ({
        approved_line_id:item.line_id,
        approved_source_id:item.source_id,
        approved_collection:item.collection,
        source_created:true,
      }))
    }
    if (path.endsWith('/financial_entries') && request.method() === 'POST') {
      genericLedgerWrites += 1
    }
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/0' }, body:JSON.stringify(body) })
  })

  const rows = [
    ['DATA', 'DESCRIÇÃO', 'RECEITA', 'DESPESA', 'CATEGORIA', 'CENTRO DE CUSTO', '', 'OBSERVAÇÃO/ SERVIÇO'],
    ...Array.from({ length:188 }, (_, index) => [
      `0${(index % 9) + 1}/09/2026`,
      index === 0 ? 'Receita para editar' : `Movimento visível ${index + 1}`,
      index % 2 === 0 ? 100 + index : '',
      index % 2 === 1 ? 50 + index : '',
      index % 2 === 0 ? 'HONORÁRIOS MÉDICOS' : 'DESP. OPERACIONAL',
      index % 2 === 0 ? 'CIRURGIA' : 'ADMINISTRATIVO',
      index === 0 ? 'Paciente teste' : '',
      '',
    ]),
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Planilha1')
  const buffer = XLSX.write(workbook, { type:'buffer', bookType:'xlsx' })

  await page.goto('/app/financial-import')
  await expect(page.getByRole('heading', { name:'Importar Lançamentos' })).toBeVisible()
  await expect(page.getByText('Nenhuma conta bancária é necessária')).toBeVisible()
  await page.getByLabel('Planilha de lançamentos').setInputFiles({ name:'retroativos.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })

  await expect(page.getByText('188 de 188 linhas exibidas')).toBeVisible()
  await expect(page.getByText('Movimento visível 188')).toBeVisible()

  const firstLine = page.locator('[aria-label="Lançamento linha 2"]')
  await firstLine.getByRole('button', { name:'Editar' }).click()
  await page.getByLabel('Descrição do lançamento').fill('Receita retroativa revisada')
  await page.getByRole('button', { name:'Aplicar edição' }).click()
  await expect(firstLine).toContainText('Receita retroativa revisada')

  await page.getByRole('button', { name:'Aprovar todas elegíveis (188)' }).click()
  await page.getByRole('button', { name:'Confirmar e salvar' }).click()

  const progress = page.getByTestId('financial-import-progress')
  await expect(progress).toContainText('Seus lançamentos estão sendo importados')
  await expect(progress).toContainText('0 de 188 importados')
  await expect(progress).toContainText('50 de 188 importados')
  await expect(progress).toContainText('Todos os lançamentos foram importados')
  await expect(progress).toContainText('188 de 188 importados')
  expect(importedBatchSizes).toEqual([50, 50, 50, 38])
  expect(genericLedgerWrites).toBe(0)

  await page.getByRole('button', { name:'Concluir' }).click()
  await expect(firstLine).toContainText('Importado')
  await expect(page.locator('[aria-label="Lançamento linha 189"]')).toContainText('Importado')
})

test('bloqueia a revisão quando o banco não consegue persistir o lote', async ({ page }) => {
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"connected":false}' }))
  await page.route('**/rest/v1/**', route => route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/0' }, body:'[]' }))
  await page.route('**/rest/v1/financial_import_batches*', route => route.fulfill({
    status:404,
    contentType:'application/json',
    body:JSON.stringify({ code:'42P01', message:'relation financial_import_batches does not exist' }),
  }))

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['DATA', 'DESCRIÇÃO', 'RECEITA', 'DESPESA', 'CATEGORIA', 'CENTRO DE CUSTO'],
    ['01/10/2026', 'Receita que não pode ficar só na memória', 100, '', 'HONORÁRIOS MÉDICOS', 'CIRURGIA'],
  ]), 'Planilha1')
  const buffer = XLSX.write(workbook, { type:'buffer', bookType:'xlsx' })

  await page.goto('/app/financial-import')
  await expect(page.getByTestId('financial-import-persistence-blocked')).toBeVisible()
  await page.getByLabel('Planilha de lançamentos').setInputFiles({ name:'sem-persistencia.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer })

  await expect(page.getByRole('alert').filter({ hasText:'não pode ser iniciada' })).toBeVisible()
  await expect(page.getByText('Receita que não pode ficar só na memória')).toHaveCount(0)
})

test('histórico lista as importações, bloqueia o que tem vínculo e cancela o lote inteiro', async ({ page }) => {
  const READY = '10000000-0000-4000-8000-00000000aaaa'
  const BLOCKED = '10000000-0000-4000-8000-00000000bbbb'
  const SOURCE_A = '20000000-0000-4000-8000-00000000aaa1'
  const SOURCE_B = '20000000-0000-4000-8000-00000000aaa2'
  let canceled = false
  let cancelPayload = null
  // Guarda contra a regressão de perda de dados: cancelar NÃO pode virar um DELETE/PATCH genérico
  // em extra_revenues/expenses pelo caminho do autosave. Toda a baixa é da RPC.
  const sourceWrites = []

  function historyRow(id, overrides) {
    return {
      id,
      file_name:id === READY ? 'retroativos-set.xlsx' : 'retroativos-out.xlsx',
      sheet_name:'Movimento',
      status:'ready',
      line_count:2,
      created_at:'2026-11-03T10:00:00Z',
      ready_at:'2026-11-03T11:00:00Z',
      canceled_at:null,
      cancellation_reason:null,
      approved_count:2,
      rejected_count:0,
      pending_count:0,
      imported_receipts:1500,
      imported_expenses:300,
      active_reconciliation_count:0,
      active_charge_count:0,
      active_fiscal_document_count:0,
      ...overrides,
    }
  }

  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"connected":false}' }))
  await page.route('**/rest/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    let body = request.method() === 'GET' ? [] : (request.postDataJSON() || [])

    if (['/extra_revenues', '/expenses'].some(table => path.endsWith(table)) && request.method() !== 'GET') {
      sourceWrites.push(`${request.method()} ${path}`)
    }
    if (path.endsWith('/rpc/list_financial_import_history')) {
      body = [
        historyRow(READY, canceled
          ? { status:'canceled', canceled_at:'2026-11-04T09:00:00Z', cancellation_reason:'planilha da clínica errada' }
          : {}),
        historyRow(BLOCKED, { active_fiscal_document_count:2 }),
      ]
    }
    if (path.endsWith('/rpc/cancel_financial_import_batch')) {
      cancelPayload = body
      canceled = true
      body = {
        batch_id:body.p_batch_id,
        status:'canceled',
        approved_count:2,
        source_ids:[SOURCE_A, SOURCE_B],
        canceled_at:'2026-11-04T09:00:00Z',
      }
    }
    return route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/0' }, body:JSON.stringify(body) })
  })

  await page.goto('/app/financial-import')

  // Com histórico no banco, a tela abre no histórico — não na lista vazia nem no upload.
  const history = page.getByTestId('financial-import-history')
  await expect(history).toBeVisible()
  await expect(history.getByText('retroativos-set.xlsx')).toBeVisible()
  await expect(history.getByText('Entradas', { exact:false }).first()).toBeVisible()

  // O lote com documento fiscal vinculado NÃO oferece cancelamento, e diz por quê.
  const blockedCard = page.getByTestId(`financial-import-history-${BLOCKED}`)
  await expect(blockedCard.getByText('2 documento(s) fiscal(is)')).toBeVisible()
  await expect(blockedCard.getByRole('button', { name:'Cancelar importação' })).toHaveCount(0)

  const readyCard = page.getByTestId(`financial-import-history-${READY}`)
  await readyCard.getByRole('button', { name:'Cancelar importação' }).click()

  // Motivo é obrigatório: sem ele a confirmação fica travada.
  const confirm = page.getByRole('button', { name:'Confirmar cancelamento' })
  await expect(confirm).toBeDisabled()
  await page.getByLabel('Motivo do cancelamento da importação').fill('planilha da clínica errada')
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect(page.getByText('2 lançamento(s) retirado(s) do financeiro', { exact:false })).toBeVisible()
  await expect(readyCard.getByText('Cancelada')).toBeVisible()
  await expect(readyCard.getByText('Motivo: planilha da clínica errada')).toBeVisible()
  await expect(readyCard.getByRole('button', { name:'Cancelar importação' })).toHaveCount(0)

  expect(cancelPayload).toMatchObject({ p_batch_id:READY, p_reason:'planilha da clínica errada' })
  expect(sourceWrites).toEqual([])
})
