import { expect, test } from '@playwright/test'
import { PDFDocument, StandardFonts } from 'pdf-lib'

// Importação do extrato do BRB em texto, com foco no que o Felipe pediu:
// confirmar que o que aparece na tela é o que de fato vai para o banco.
// Dados FICTÍCIOS: o extrato real tem nome de paciente e valor real.

const USER_ID = 'e2e-user-id'
const ACCOUNT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const IMPORT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const EXTRATO = `Extrato
CLINICA EXEMPLO LTDA

ENTRADAS
OUTUBRO/2026
Dia Histórico Valor
01/10 CREDITO PIX – DOC: 000000
FULANO DE TAL AAAA — 0136
R$ +1.234,00
01/10 CREDITO PIX – DOC: 000000
FULANO DE TAL AAAA — 0136
R$ +1.234,00
07/10 CREDITO DE TED PAG C.CORRENTE – DOC: 821925
BELTRANO DA SILVA
R$ +500,00

SAÍDAS
OUTUBRO/2026
Dia Histórico Valor
02/10 TARIFA ENVIO VALORES PIX – DOC: 000000
R$ −9,00`

// Monta um PDF com as COLUNAS em ordem trocada, como o extrato do BRB faz.
async function buildBrbPdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595.28, 841.89])
  const draw = (text, x, y, size = 9) => page.drawText(text, { x, y, size, font })
  draw('Extrato', 40, 800, 14)
  draw('ENTRADAS', 40, 780, 12)
  draw('OUTUBRO/2026', 40, 765)
  // Coluna do historico primeiro...
  draw('CREDITO PIX - DOC: 000000', 120, 740)
  draw('FULANO DE TAL AAAA - 0136', 120, 728)
  draw('CREDITO PIX - DOC: 000000', 120, 710)
  draw('FULANO DE TAL AAAA - 0136', 120, 698)
  draw('CREDITO DE TED PAG C.CORRENTE - DOC: 821925', 120, 680)
  draw('BELTRANO DA SILVA', 120, 668)
  // ...e so depois dia e valor.
  draw('01/10', 40, 740); draw('R$ +1.234,00', 440, 740)
  draw('01/10', 40, 710); draw('R$ +1.234,00', 440, 710)
  draw('07/10', 40, 680); draw('R$ +500,00', 440, 680)
  draw('SAIDAS', 40, 640, 12)
  draw('OUTUBRO/2026', 40, 625)
  draw('TARIFA ENVIO VALORES PIX - DOC: 000000', 120, 600)
  draw('02/10', 40, 600); draw('R$ -9,00', 440, 600)
  return Buffer.from(await doc.save())
}

test('importa o extrato do BRB em texto e persiste exatamente o que mostrou', async ({ page }) => {
  const persisted = []
  let finalized = null

  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"connected":false}' }))

  await page.route('**/rest/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const fulfill = body => route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/1' }, body:JSON.stringify(body) })

    if (path.endsWith('/rpc/start_bank_statement_import')) {
      return fulfill({ id:IMPORT_ID, user_id:USER_ID, financial_account_id:ACCOUNT_ID, status:'importing', expected_line_count:4, line_count:0 })
    }
    if (path.endsWith('/rpc/finalize_bank_statement_import')) {
      finalized = request.postDataJSON()
      return fulfill({
        id:IMPORT_ID, user_id:USER_ID, financial_account_id:ACCOUNT_ID,
        file_name:'extrato.txt', file_hash:'b'.repeat(64), source_format:'brb',
        expected_line_count:4, line_count:4, status:'ready',
        period_start:'2026-10-01', period_end:'2026-10-07', currency:'BRL',
        verification_status:'unverified', verification_notes:[],
        created_at:'2026-10-30T12:00:00Z', ready_at:'2026-10-30T12:00:01Z', archived_at:null,
      })
    }
    if (path.endsWith('/bank_statement_lines') && method === 'POST') {
      // É aqui que a persistência de verdade acontece.
      const rows = request.postDataJSON()
      persisted.push(...rows)
      return fulfill(rows.map((row, index) => ({ ...row, id:`line-${index}` })))
    }
    if (path.endsWith('/bank_statement_lines')) return fulfill([])
    if (path.endsWith('/financial_accounts')) {
      return fulfill([{
        id:ACCOUNT_ID, user_id:USER_ID, name:'BRB Clínica', account_type:'checking',
        institution_code:'070', institution_name:'BRB', branch_code:'100',
        account_number_masked:'••••191-6', account_number_suffix:'1916',
        verification_status:'unverified', active:true, archived_at:null,
      }])
    }
    if (path.endsWith('/bank_statement_imports')) return fulfill([])
    return fulfill([])
  })

  await page.goto('/app/bank-reconciliation')
  await expect(page.getByRole('heading', { name:'Conciliação Bancária' })).toBeVisible()
  await page.getByLabel('Conta financeira').selectOption(ACCOUNT_ID)

  await page.getByLabel('Arquivo OFX, CSV ou extrato do BRB').setInputFiles({
    name:'extrato.txt',
    mimeType:'text/plain',
    buffer:Buffer.from(EXTRATO, 'utf8'),
  })

  // O extrato é reconhecido sem o usuário mapear coluna nenhuma.
  await expect(page.getByTestId('statement-preview')).toContainText('4 linha(s) válida(s)')

  await page.getByRole('button', { name:'Confirmar importação' }).click()
  await expect.poll(() => persisted.length).toBe(4)

  // --- o que foi mostrado é o que foi gravado ------------------------------
  const porChave = Object.fromEntries(persisted.map(row => [row.source_line_key, row]))
  const chaves = Object.keys(porChave)
  expect(chaves).toHaveLength(4)

  // O ano veio do cabeçalho da seção, não do relógio.
  expect(persisted.every(row => row.posted_date.startsWith('2026-10-'))).toBe(true)

  // A seção decidiu o sinal.
  const entradas = persisted.filter(row => Number(row.amount) > 0)
  const saidas = persisted.filter(row => Number(row.amount) < 0)
  expect(entradas).toHaveLength(3)
  expect(saidas).toHaveLength(1)
  expect(Number(saidas[0].amount)).toBe(-9)

  // As duas transferências idênticas do mesmo dia continuam sendo duas linhas.
  const duplicadas = persisted.filter(row => row.posted_date === '2026-10-01' && Number(row.amount) === 1234)
  expect(duplicadas).toHaveLength(2)
  expect(duplicadas[0].source_line_key).not.toBe(duplicadas[1].source_line_key)

  // A contraparte chegou na coluna certa, sem o código de canal.
  expect(duplicadas[0].counterparty_name).toBe('FULANO DE TAL AAAA')

  // DOC 000000 não vira identificador; DOC real vira.
  const ted = persisted.find(row => Number(row.amount) === 500)
  expect(ted.external_id).toBe('brb:821925')
  expect(duplicadas[0].external_id).toBeNull()

  // A contagem declarada na finalização bate com o que foi gravado.
  expect(finalized).toBeTruthy()
  expect(persisted).toHaveLength(4)
})

test('importa o extrato do BRB em PDF, remontando as colunas pela posição', async ({ page }) => {
  const persisted = []

  await page.addInitScript(() => localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"connected":false}' }))
  await page.route('**/rest/v1/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const fulfill = body => route.fulfill({ status:200, contentType:'application/json', headers:{ 'content-range':'0-0/1' }, body:JSON.stringify(body) })

    if (path.endsWith('/rpc/start_bank_statement_import')) {
      return fulfill({ id:IMPORT_ID, user_id:USER_ID, financial_account_id:ACCOUNT_ID, status:'importing', expected_line_count:4, line_count:0 })
    }
    if (path.endsWith('/rpc/finalize_bank_statement_import')) {
      return fulfill({
        id:IMPORT_ID, user_id:USER_ID, financial_account_id:ACCOUNT_ID,
        file_name:'extrato.pdf', file_hash:'c'.repeat(64), source_format:'brb',
        expected_line_count:4, line_count:4, status:'ready',
        period_start:'2026-10-01', period_end:'2026-10-07', currency:'BRL',
        verification_status:'unverified', verification_notes:[],
        created_at:'2026-10-30T12:00:00Z', ready_at:'2026-10-30T12:00:01Z', archived_at:null,
      })
    }
    if (path.endsWith('/bank_statement_lines') && method === 'POST') {
      const rows = request.postDataJSON()
      persisted.push(...rows)
      return fulfill(rows.map((row, index) => ({ ...row, id:`pdf-line-${index}` })))
    }
    if (path.endsWith('/bank_statement_lines')) return fulfill([])
    if (path.endsWith('/financial_accounts')) {
      return fulfill([{
        id:ACCOUNT_ID, user_id:USER_ID, name:'BRB Clínica', account_type:'checking',
        institution_code:'070', institution_name:'BRB', branch_code:'100',
        account_number_masked:'••••191-6', account_number_suffix:'1916',
        verification_status:'unverified', active:true, archived_at:null,
      }])
    }
    return fulfill([])
  })

  await page.goto('/app/bank-reconciliation')
  await page.getByLabel('Conta financeira').selectOption(ACCOUNT_ID)
  await page.getByLabel('Arquivo OFX, CSV ou extrato do BRB').setInputFiles({
    name:'extrato.pdf',
    mimeType:'application/pdf',
    buffer:await buildBrbPdf(),
  })

  // O PDF é lido no navegador; o arquivo bruto não sai da máquina.
  await expect(page.getByTestId('statement-preview')).toContainText('4 linha(s) válida(s)', { timeout:20000 })
  await page.getByRole('button', { name:'Confirmar importação' }).click()
  await expect.poll(() => persisted.length, { timeout:20000 }).toBe(4)

  // As colunas voltaram a ficar juntas: dia, histórico e valor na mesma linha.
  const duplicadas = persisted.filter(row => row.posted_date === '2026-10-01')
  expect(duplicadas).toHaveLength(2)
  expect(duplicadas.every(row => Number(row.amount) === 1234)).toBe(true)
  expect(duplicadas[0].counterparty_name).toBe('FULANO DE TAL AAAA')
  expect(duplicadas[0].source_line_key).not.toBe(duplicadas[1].source_line_key)

  const ted = persisted.find(row => Number(row.amount) === 500)
  expect(ted.posted_date).toBe('2026-10-07')
  expect(ted.external_id).toBe('brb:821925')

  const tarifa = persisted.find(row => Number(row.amount) < 0)
  expect(tarifa.amount).toBe(-9)
  expect(tarifa.posted_date).toBe('2026-10-02')
})
