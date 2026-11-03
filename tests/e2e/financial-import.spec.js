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
      body = { id:'10000000-0000-4000-8000-000000000001', file_name:'retroativos.xlsx', file_hash:'a'.repeat(64), sheet_name:'Planilha1', line_count:188, status:'reviewing', created_at:'2026-11-03T10:00:00Z' }
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
