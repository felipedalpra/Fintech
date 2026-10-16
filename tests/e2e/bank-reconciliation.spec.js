import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'

const USER_ID = 'e2e-user-id'
const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const IMPORT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const LINE_REVENUE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LINE_EXPENSE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const ENTRY_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const INSTALLMENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const SOURCE_ID = '11111111-1111-4111-8111-111111111111'

test('importa, concilia, persiste no reload, desconcilia e abre cadastro real', async ({ page }) => {
  let imported = false
  let lines = []
  let reconciliations = []
  const imports = []

  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"connected":false}' }))
  await page.route('**/rest/v1/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const fulfill = body => route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/1' }, body:JSON.stringify(body) })

    if (path.endsWith('/rpc/start_bank_statement_import')) {
      return fulfill({ id:IMPORT_ID, user_id:USER_ID, financial_account_id:ACCOUNT_ID, status:'importing', expected_line_count:2, line_count:0 })
    }
    if (path.endsWith('/rpc/finalize_bank_statement_import')) {
      imported = true
      const ready = { id:IMPORT_ID, user_id:USER_ID, financial_account_id:ACCOUNT_ID, file_name:'extrato-e2e.ofx', file_hash:'a'.repeat(64), source_format:'ofx', expected_line_count:2, line_count:2, status:'ready', period_start:'2026-10-13', period_end:'2026-10-14', created_at:'2026-10-14T12:00:00Z', ready_at:'2026-10-14T12:00:01Z', archived_at:null }
      imports.splice(0, imports.length, ready)
      return fulfill(ready)
    }
    if (path.endsWith('/rpc/claim_bank_statement_lines_for_creation')) {
      const body = request.postDataJSON()
      lines = lines.map(line => body.p_line_ids.includes(line.id) ? { ...line, review_status:'processing', review_claim_token:body.p_claim_token } : line)
      return fulfill(body.p_line_ids.length)
    }
    if (path.endsWith('/rpc/release_bank_statement_line_claims')) {
      const body = request.postDataJSON()
      lines = lines.map(line => body.p_line_ids.includes(line.id) && line.review_claim_token === body.p_claim_token ? { ...line, review_status:'pending', review_claim_token:null } : line)
      return fulfill(body.p_line_ids.length)
    }
    if (path.endsWith('/rpc/confirm_bank_reconciliation')) {
      const body = request.postDataJSON()
      const created = { id:'99999999-9999-4999-8999-999999999999', user_id:USER_ID, statement_line_id:body.p_line_id, financial_installment_id:body.p_installment_id, match_method:body.p_method, score:body.p_score, match_reasons:body.p_reasons, difference_amount:0, difference_days:0, confirmed_at:'2026-10-14T12:02:00Z', reversed_at:null }
      reconciliations.unshift(created)
      return fulfill(created)
    }
    if (path.endsWith('/rpc/reverse_bank_reconciliation')) {
      reconciliations = reconciliations.map(item => ({ ...item, reversed_at:'2026-10-14T12:03:00Z', reversal_reason:'Teste de reversão' }))
      return fulfill(reconciliations[0])
    }
    if (path.endsWith('/rpc/archive_bank_statement_import')) return fulfill({ ...imports[0], status:'archived', archived_at:'2026-10-14T12:04:00Z' })

    if (path.endsWith('/financial_accounts')) return fulfill([{ id:ACCOUNT_ID, user_id:USER_ID, name:'Banco E2E', account_type:'checking', active:true, archived_at:null }])
    if (path.endsWith('/bank_statement_imports')) return fulfill(imported ? imports : [])
    if (path.endsWith('/bank_statement_lines')) {
      if (method === 'POST') {
        const incoming = request.postDataJSON()
        lines = incoming.map((item, index) => ({ ...item, id:index === 0 ? LINE_REVENUE_ID : LINE_EXPENSE_ID, created_at:'2026-10-14T12:00:00Z', archived_at:null }))
        return fulfill(lines.map(item => ({ id:item.id, source_line_key:item.source_line_key })))
      }
      if (url.searchParams.get('import_id')?.startsWith('neq.')) return fulfill([])
      return fulfill(lines)
    }
    if (path.endsWith('/bank_reconciliations')) {
      return fulfill(url.searchParams.get('reversed_at') === 'is.null'
        ? reconciliations.filter(item => !item.reversed_at)
        : reconciliations)
    }
    if (path.endsWith('/financial_installments')) return fulfill([{
      id:INSTALLMENT_ID, user_id:USER_ID, financial_entry_id:ENTRY_ID, installment_number:1,
      amount:500, paid_amount:500, due_date:'2026-10-13', settlement_date:'2026-10-13', payment_method:'pix', financial_account_id:ACCOUNT_ID, status:'paid', archived_at:null,
      financial_entries:{ id:ENTRY_ID, user_id:USER_ID, direction:'receivable', source_type:'extra_revenue', source_id:SOURCE_ID, source_component:'revenue', description:'Consulta Maria', party_name_snapshot:'Maria', category:'Consultas', origin_label:null, issue_date:'2026-10-13', competence_date:'2026-10-13', status:'paid', archived_at:null },
    }])
    if (path.endsWith('/extra_revenues')) return fulfill([{
      id:SOURCE_ID, user_id:USER_ID, description:'Consulta Maria', category:'Consultas', value:500,
      date:'2026-10-13', received_date:'2026-10-13', due_date:'2026-10-13', competence_date:'2026-10-13', status:'recebido', archived_at:null,
    }])
    if (method === 'GET') return fulfill([])
    return fulfill([])
  })

  await page.goto('/app/bank-reconciliation')
  await expect(page.getByRole('heading', { name:'Conciliação Bancária' })).toBeVisible()
  await page.getByLabel('Conta financeira').selectOption(ACCOUNT_ID)
  await page.getByLabel('Arquivo OFX, CSV ou XLSX').setInputFiles({
    name:'extrato-e2e.ofx',
    mimeType:'application/x-ofx',
    buffer:Buffer.from(`OFXHEADER:100\n<OFX><BANKTRANLIST>
      <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261013<TRNAMT>500.00<FITID>fit-1<MEMO>PIX MARIA</STMTTRN>
      <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261014<TRNAMT>-18.90<FITID>fit-2<MEMO>TARIFA BANCO</STMTTRN>
    </BANKTRANLIST></OFX>`),
  })
  await expect(page.getByTestId('statement-preview')).toContainText('2 linha(s) válida(s)')
  await page.getByRole('button', { name:'Confirmar importação' }).click()
  await expect(page.getByText('Sugestões', { exact:true })).toBeVisible()
  await expect(page.getByTestId('statement-line-suggestion')).toContainText('PIX MARIA')
  await expect(page.getByTestId('statement-line-unmatched')).toContainText('TARIFA BANCO')

  const suggestion = page.getByTestId('statement-line-suggestion')
  await suggestion.getByRole('button', { name:'Conferir e vincular' }).click()
  await page.getByRole('button', { name:'Confirmar vínculo', exact:true }).click()
  await expect(page.getByTestId('statement-line-reconciled')).toContainText('Vínculo confirmado')

  await page.reload()
  await expect(page.getByTestId('statement-line-reconciled')).toContainText('PIX MARIA')
  await page.getByTestId('statement-line-reconciled').getByRole('button', { name:'Desconciliar' }).click()
  await page.getByText('Motivo').locator('..').getByRole('textbox').fill('Teste de reversão')
  await page.getByRole('button', { name:'Desconciliar', exact:true }).last().click()
  await expect(page.getByTestId('statement-line-suggestion')).toContainText('PIX MARIA')

  await page.reload()
  await expect(page.getByTestId('statement-line-suggestion')).toContainText('PIX MARIA')
  await page.getByTestId('statement-line-unmatched').getByRole('button', { name:'Criar despesa' }).click()
  await expect(page).toHaveURL(/\/app\/finance$/)
  const modal = page.getByRole('heading', { name:'Novo registro' }).locator('../..')
  await expect(modal.getByPlaceholder('Ex: aluguel do consultório')).toHaveValue('TARIFA BANCO')
  await expect(modal.locator('input[inputmode="decimal"]')).toHaveValue('18,90')
  await expect(modal.locator('input[type="date"]').first()).toHaveValue('')
  const manualDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('surgimetrics_modal_draft_finance') || 'null'))
  expect(manualDraft.reconciliationReturn).toMatchObject({ lineId:LINE_EXPENSE_ID, sourceId:LINE_EXPENSE_ID })
  expect(manualDraft.reconciliationReturn.claimToken).toMatch(/^[0-9a-f-]{36}$/i)
})

test('importa XLSX, aprova lançamento canônico, recarrega e mantém revisão reversível', async ({ page }) => {
  const importId = '22222222-2222-4222-8222-222222222222'
  const feeLineId = '33333333-3333-4333-8333-333333333333'
  const transferLineId = '44444444-4444-4444-8444-444444444444'
  let imported = false
  let lines = []
  let savedExpenses = []
  let persistedEntries = []
  let persistedInstallments = []
  let reconciliations = []
  let expenseUpserts = 0

  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"connected":false}' }))
  await page.route('**/rest/v1/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const fulfill = body => route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/1' }, body:JSON.stringify(body) })

    if (path.endsWith('/rpc/start_bank_statement_import')) return fulfill({ id:importId, user_id:USER_ID, financial_account_id:ACCOUNT_ID, status:'importing', expected_line_count:2, line_count:0 })
    if (path.endsWith('/rpc/finalize_bank_statement_import')) {
      imported = true
      return fulfill({ id:importId, user_id:USER_ID, financial_account_id:ACCOUNT_ID, file_name:'movimentos.xlsx', file_hash:'b'.repeat(64), source_format:'xlsx', expected_line_count:2, line_count:2, status:'ready', period_start:'2026-09-01', period_end:'2026-09-02', created_at:'2026-10-15T12:00:00Z', ready_at:'2026-10-15T12:00:01Z', archived_at:null })
    }
    if (path.endsWith('/rpc/claim_bank_statement_lines_for_creation')) {
      const body = request.postDataJSON()
      lines = lines.map(line => body.p_line_ids.includes(line.id) ? { ...line, review_status:'processing', review_claim_token:body.p_claim_token, reviewed_at:'2026-10-15T12:01:00Z' } : line)
      return fulfill(body.p_line_ids.length)
    }
    if (path.endsWith('/rpc/release_bank_statement_line_claims')) {
      const body = request.postDataJSON()
      lines = lines.map(line => body.p_line_ids.includes(line.id) && line.review_claim_token === body.p_claim_token ? { ...line, review_status:'pending', review_claim_token:null } : line)
      return fulfill(body.p_line_ids.length)
    }
    if (path.endsWith('/rpc/confirm_bank_reconciliation')) {
      const body = request.postDataJSON()
      const created = { id:'77777777-7777-4777-8777-777777777777', user_id:USER_ID, statement_line_id:body.p_line_id, financial_installment_id:body.p_installment_id, match_method:body.p_method, score:body.p_score, match_reasons:body.p_reasons, difference_amount:0, difference_days:0, confirmed_at:'2026-10-15T12:01:30Z', reversed_at:null }
      reconciliations = [created]
      return fulfill(created)
    }
    if (path.endsWith('/rpc/set_bank_statement_lines_review')) {
      const body = request.postDataJSON()
      lines = lines.map(line => body.p_line_ids.includes(line.id) ? { ...line, review_status:body.p_status, review_reason:body.p_reason, reviewed_at:'2026-10-15T12:02:00Z' } : line)
      return fulfill(body.p_line_ids.length)
    }
    if (path.endsWith('/financial_accounts')) return fulfill([{ id:ACCOUNT_ID, user_id:USER_ID, name:'Banco E2E', account_type:'checking', active:true, archived_at:null }])
    if (path.endsWith('/bank_statement_imports')) return fulfill(imported ? [{ id:importId, user_id:USER_ID, financial_account_id:ACCOUNT_ID, file_name:'movimentos.xlsx', file_hash:'b'.repeat(64), source_format:'xlsx', expected_line_count:2, line_count:2, status:'ready', period_start:'2026-09-01', period_end:'2026-09-02', archived_at:null }] : [])
    if (path.endsWith('/bank_statement_lines')) {
      if (method === 'POST') {
        lines = request.postDataJSON().map((item, index) => ({ ...item, id:index === 0 ? feeLineId : transferLineId, review_status:'pending', created_at:'2026-10-15T12:00:00Z', archived_at:null }))
        return fulfill(lines.map(item => ({ id:item.id, source_line_key:item.source_line_key })))
      }
      if (url.searchParams.get('import_id')?.startsWith('neq.')) return fulfill([])
      return fulfill(lines)
    }
    if (path.endsWith('/chart_accounts')) return fulfill([
      { id:'55555555-5555-4555-8555-555555555555', user_id:USER_ID, code:'8.02.04', name:'Tarifas bancárias', nature:'financial_expense', dre_section:'financial_result', node_type:'account', is_active:true, system_key:null, sort_order:10 },
      { id:'66666666-6666-4666-8666-666666666666', user_id:USER_ID, code:'10.02', name:'Pagamento a classificar', nature:'unclassified', dre_section:'unclassified', node_type:'account', is_active:true, system_key:'unclassified_expense', sort_order:20 },
    ])
    if (path.endsWith('/expenses')) {
      if (method === 'GET') return fulfill(savedExpenses)
      if (method === 'POST') {
        const incoming = request.postDataJSON()
        savedExpenses = Array.isArray(incoming) ? incoming : [incoming]
        expenseUpserts += savedExpenses.length
        return fulfill(savedExpenses.map(item => ({ id:item.id })))
      }
      return fulfill([])
    }
    if (path.endsWith('/financial_entries')) {
      if (method === 'POST') {
        const incoming = request.postDataJSON()
        persistedEntries = (Array.isArray(incoming) ? incoming : [incoming]).map(item => ({ ...item, id:'88888888-8888-4888-8888-888888888888' }))
        return fulfill(persistedEntries.map(item => ({ id:item.id, source_type:item.source_type, source_id:item.source_id, source_component:item.source_component })))
      }
      return fulfill(persistedEntries)
    }
    if (path.endsWith('/financial_installments')) {
      if (method === 'POST') {
        const incoming = request.postDataJSON()
        persistedInstallments = (Array.isArray(incoming) ? incoming : [incoming]).map((item, index) => ({
          ...item,
          id:`99999999-9999-4999-8999-99999999999${index}`,
          archived_at:null,
          financial_entries:persistedEntries.find(entry => entry.id === item.financial_entry_id),
        }))
        return fulfill([])
      }
      return fulfill(persistedInstallments)
    }
    if (path.endsWith('/bank_reconciliations')) return fulfill(reconciliations.filter(item => !item.reversed_at))
    if (method === 'GET') return fulfill([])
    return fulfill([])
  })

  const sheet = XLSX.utils.aoa_to_sheet([
    ['DATA', 'DESCRIÇÃO', 'RECEITA', 'DESPESA', 'CATEGORIA', 'CENTRO DE CUSTO'],
    [46266, 'TARIFA ENVIO VALORES PIX', '', 9, 'DESP. BANCÁRIA', 'FINANCEIRO'],
    [46267, 'DEBITO PIX INTERNO', '', 50000, '', ''],
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Planilha1')
  const fileBuffer = Buffer.from(XLSX.write(workbook, { type:'array', bookType:'xlsx' }))

  await page.goto('/app/bank-reconciliation')
  await page.getByLabel('Conta financeira').selectOption(ACCOUNT_ID)
  await page.getByLabel('Arquivo OFX, CSV ou XLSX').setInputFiles({ name:'movimentos.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer:fileBuffer })
  await expect(page.getByTestId('statement-preview')).toContainText('2 linha(s) válida(s)')
  await expect(page.getByTestId('statement-preview')).toContainText('XLSX')
  await page.getByRole('button', { name:'Confirmar importação' }).click()

  await expect(page.locator('[data-review-status="new"]')).toContainText('TARIFA ENVIO VALORES PIX')
  await expect(page.locator('[data-review-status="review"]')).toContainText('DEBITO PIX INTERNO')
  await page.getByLabel('Selecionar todas as sugestões seguras visíveis').check()
  await page.getByRole('button', { name:'Aprovar selecionados (1)' }).click()
  await expect(page.getByRole('heading', { name:'Aprovar sugestões' })).toBeVisible()
  await expect(page.getByText('Correspondências existentes serão apenas vinculadas.')).toBeVisible()
  await page.getByRole('button', { name:'Confirmar aprovação' }).click()
  await expect(page.locator('[data-review-status="reconciled"]')).toContainText('TARIFA ENVIO VALORES PIX')
  expect(expenseUpserts).toBe(1)
  expect(savedExpenses).toHaveLength(1)
  expect(savedExpenses[0]).toMatchObject({ id:feeLineId, value:9, status:'pago', chart_account_id:'55555555-5555-4555-8555-555555555555' })
  expect(reconciliations[0]).toMatchObject({ statement_line_id:feeLineId, match_method:'created_from_line' })
  await page.reload()
  await expect(page.locator('[data-review-status="reconciled"]')).toContainText('TARIFA ENVIO VALORES PIX')
  expect(expenseUpserts).toBe(1)

  await page.getByRole('button', { name:'Revisar' }).click()
  await page.getByRole('button', { name:'Ignorar visíveis' }).click()
  await page.getByRole('button', { name:'Confirmar que deseja ignorar' }).click()
  await page.getByRole('button', { name:'Ignorados' }).click()
  await expect(page.locator('[data-review-status="ignored"]')).toContainText('DEBITO PIX INTERNO')
  await page.reload()
  await expect(page.locator('[data-review-status="ignored"]')).toContainText('DEBITO PIX INTERNO')
  await page.locator('[data-review-status="ignored"]').getByRole('button', { name:'Reabrir revisão' }).click()
  await expect(page.locator('[data-review-status="review"]')).toContainText('DEBITO PIX INTERNO')
  await page.reload()
  await expect(page.locator('[data-review-status="review"]')).toContainText('DEBITO PIX INTERNO')
})
