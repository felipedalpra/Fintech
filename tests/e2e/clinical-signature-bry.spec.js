import { expect, test } from '@playwright/test'

// Mocks existem SOMENTE aqui: nenhum teste chama a BRy de verdade.
//
// A partir de 16/11/2026 (pedido do Felipe: unificar os dois lugares de
// assinar e tirar frase técnica da tela), a assinatura inteira acontece só
// na central Clínico -> Documentos: não existe mais botão de assinar dentro
// da ficha do paciente. A ficha só mostra o selo de status e um botão que
// leva para aqui (ver tests/e2e/clinical-records.spec.js para a navegação
// ficha -> central).

const AUTHOR = 'e2e-user-id'
const DOCUMENT = '30000000-0000-4000-8000-000000000001'
const ATTEMPT = '60000000-0000-4000-8000-000000000001'
const SIGNING_URL = 'https://easysign.hom.bry.com.br/80000000-0000-4000-8000-000000000001/sign/signer-1'

function documentRow(overrides = {}) {
  return {
    id:DOCUMENT,
    user_id:AUTHOR,
    patient_id:'patient-signature',
    created_by:AUTHOR,
    document_type:'exam_request',
    issue_date:'2026-10-28',
    document_data:{ exams:['Hemograma completo'] },
    patient_name:'Ana Assinatura',
    patient_cpf:'123.456.789-00',
    patient_address:'Rua Paciente, 25',
    author_name:'Dra. Clínica E2E',
    author_registration:'CRM-RS 0001',
    author_council:'CRM',
    issuer_contact:'medica@clinica.test',
    issuer_address:'Av. Clínica, 100',
    clinic_name:'Clínica E2E',
    created_at:'2026-10-28T09:00:00Z',
    ...overrides,
  }
}

// Linha da tabela clinical_document_signatures: é só o que alimenta o selo
// grosso da lista (status), nunca o motivo detalhado — esse vem da resposta
// das ações (request/reconcile), capturada pelo diálogo em tempo real.
function signatureRow(overrides = {}) {
  return { id:ATTEMPT, document_id:DOCUMENT, status:'pending', created_at:'2026-10-28T10:00:00Z', ...overrides }
}

async function openDocumentsCenter(page, {
  documents = [documentRow()],
  queueDocuments = [],
  signatures:initialSignatures = [],
  calls = {},
  requestHandler,
  reconcileHandler,
  linkHandler,
  artifactHandler,
  abandonHandler,
} = {}) {
  // Mutavel de verdade: as acoes padrao (request/abandon) escrevem aqui pra
  // que o proximo refetch de clinical_document_signatures reflita o que
  // "persistiu", igual o backend real faria.
  const signatures = [...initialSignatures]
  await page.setViewportSize({ width:1280, height:900 })
  await page.addInitScript(() => {
    window.localStorage.setItem('surgimetrics_onboarded', 'true')
    // Impede que a aba da assinatura realmente abra durante o teste e
    // registra a URL e as flags de segurança usadas.
    window.__openedWindows = []
    window.open = (url, target, features) => {
      window.__openedWindows.push({ url, target, features })
      return window.__popupBlocked ? null : { opener:null, focus() {}, print() {} }
    }
  })

  await page.route('**/api/secure-profile?action=get', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ profile:{
      doctor:{ fullName:'Dra. Clínica E2E', registrationId:'CRM-RS 0001', cpf:'529.982.247-25', specialty:'Cirurgia Plástica' },
      clinic:{ tradeName:'Clínica E2E', addressLine:'Av. Clínica, 100', city:'Porto Alegre', state:'RS' },
    } }),
  }))
  await page.route('**/rest/v1/rpc/sync_clinical_professional_identity*', route => route.fulfill({ status:200, contentType:'application/json', body:'true' }))

  await page.route('**/api/secure-profile?action=clinical-signature-request', async route => {
    calls.request = (calls.request || 0) + 1
    if (requestHandler) return requestHandler(route, calls, signatures)
    signatures.length = 0
    signatures.push(signatureRow())
    await route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify({ attempts:[{ id:ATTEMPT, documentId:DOCUMENT, status:'pending' }], signingUrl:SIGNING_URL }),
    })
  })

  await page.route('**/api/secure-profile?action=clinical-signature-queue', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({
      available:true,
      maxPerEnvelope:10,
      integration:{ available:true, environment:'homologation', reason:null, requestedMode:'QUALIFIED' },
      documents:queueDocuments,
    }),
  }))

  await page.route('**/api/secure-profile?action=clinical-signature-link', async route => {
    calls.link = (calls.link || 0) + 1
    if (linkHandler) return linkHandler(route, calls, signatures)
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ signingUrl:SIGNING_URL }) })
  })

  await page.route('**/api/secure-profile?action=clinical-signature-reconcile', async route => {
    calls.reconcile = (calls.reconcile || 0) + 1
    if (reconcileHandler) return reconcileHandler(route, calls, signatures)
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ attempt:{ id:ATTEMPT, status:'pending' } }) })
  })

  await page.route('**/api/secure-profile?action=clinical-signature-abandon', async route => {
    calls.abandon = (calls.abandon || 0) + 1
    if (abandonHandler) return abandonHandler(route, calls, signatures)
    signatures.length = 0
    signatures.push(signatureRow({ status:'failed' }))
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ attempt:{ id:ATTEMPT, status:'failed', failureMessage:'Tentativa encerrada pelo profissional.' } }) })
  })

  await page.route('**/api/secure-profile?action=clinical-signature-artifact', async route => {
    calls.artifact = (calls.artifact || 0) + 1
    if (artifactHandler) return artifactHandler(route, calls)
    await route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify({ url:'https://storage.test/assinado.pdf?token=abc', expiresInSeconds:60, kind:'signed' }),
    })
  })

  await page.route('**/rest/v1/patients*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([{ id:'patient-signature', full_name:'Ana Assinatura', date_of_birth:'1990-04-10', active:true }]),
  }))
  await page.route('**/rest/v1/clinical_documents*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(documents) }))
  await page.route('**/rest/v1/clinical_document_signatures*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(signatures) }))
  for (const table of [
    'medical_records', 'medical_record_addenda', 'clinical_anamneses', 'clinical_intake_requests',
    'clinical_intake_submissions', 'clinical_assets', 'clinical_treatment_plans',
    'clinical_treatment_plan_versions', 'clinical_treatment_plan_status_events',
    'clinical_treatment_sessions', 'clinical_treatment_session_events', 'clinical_protocols',
    'clinical_protocol_versions', 'clinical_protocol_status_events', 'clinical_patient_pending_overrides',
  ]) {
    await page.route(`**/rest/v1/${table}*`, route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  }

  await page.goto('/app/clinical-documents')
  await expect(page.getByTestId('clinical-documents-center')).toBeVisible({ timeout:30_000 })
  return page.locator('.clinical-documents-center-list > article').first()
}

function queueDocument(index) {
  return {
    id:`30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    documentType:index % 2 ? 'exam_request' : 'simple_prescription',
    issueDate:'2026-10-28',
    patientId:'patient-signature',
    patientName:`Paciente ${index}`,
    createdAt:`2026-10-28T${String(9 + index).padStart(2, '0')}:00:00Z`,
  }
}

test('não permite iniciar assinatura com menos de dez documentos disponíveis', async ({ page }) => {
  const queueDocuments = Array.from({ length:9 }, (_, index) => queueDocument(index + 1))
  await openDocumentsCenter(page, { queueDocuments })

  const queue = page.getByTestId('clinical-sign-queue')
  await expect(queue).toBeVisible()
  await expect(queue).toContainText('A BRy exige exatamente 10 documentos')
  await expect(queue).toContainText('Faltam 1')
  await expect(queue.getByRole('button', { name:'Selecionar 10' })).toBeDisabled()
  await expect(queue.getByRole('button', { name:'Assinar lote de 10' })).toBeDisabled()
})

test('seleciona exatamente dez documentos, confirma o custo e envia um único lote', async ({ page }) => {
  const calls = {}
  let requestPayload = null
  const queueDocuments = Array.from({ length:10 }, (_, index) => queueDocument(index + 1))
  await openDocumentsCenter(page, {
    calls,
    queueDocuments,
    requestHandler:async (route, calls2, signatures) => {
      requestPayload = route.request().postDataJSON()
      signatures.length = 0
      await route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify({ attempts:[], signingUrl:SIGNING_URL }),
      })
    },
  })

  const queue = page.getByTestId('clinical-sign-queue')
  const checkboxes = queue.getByRole('checkbox')
  await expect(checkboxes).toHaveCount(10)
  for (let index = 0; index < 9; index += 1) await checkboxes.nth(index).check()
  await expect(queue.getByTestId('clinical-sign-queue-count')).toHaveText('9 de 10 selecionados')
  await expect(queue.getByRole('button', { name:'Assinar lote de 10' })).toBeDisabled()

  await checkboxes.nth(9).check()
  await expect(queue.getByTestId('clinical-sign-queue-count')).toHaveText('10 de 10 selecionados')
  await expect(queue.getByRole('button', { name:'Assinar lote de 10' })).toBeEnabled()
  await queue.getByRole('button', { name:'Assinar lote de 10' }).click()
  await expect(queue.getByRole('group', { name:'Confirmar assinatura em lote' })).toContainText('exatamente 10 documentos')
  expect(calls.request).toBeUndefined()

  await queue.getByRole('button', { name:'Confirmar e assinar' }).click()
  await expect.poll(() => calls.request).toBe(1)
  expect(requestPayload.documentIds).toHaveLength(10)
  expect(new Set(requestPayload.documentIds).size).toBe(10)
  expect(requestPayload.documentIds).toEqual(queueDocuments.map(document => document.id))
  await expect.poll(() => page.evaluate(() => window.__openedWindows.length)).toBe(1)
})

test('não oferece assinatura individual e orienta para o lote de dez', async ({ page }) => {
  const calls = {}
  const row = await openDocumentsCenter(page, { calls })

  await expect(row).toContainText('Ainda não assinado')
  await expect(row.getByRole('button', { name:'Entrar no lote de 10' })).toBeVisible()

  await row.getByRole('button', { name:'Entrar no lote de 10' }).click()
  const dialog = page.locator('.clinical-sign-document-dialog')
  await expect(dialog).toContainText('A BRy exige exatamente 10 documentos por envelope')
  await expect(dialog).toContainText('Nenhum envelope foi criado para este documento individual')
  expect(calls.request).toBeUndefined()

  await dialog.getByRole('button', { name:'Voltar para a fila de 10 documentos' }).click()
  await expect(dialog).toHaveCount(0)
  expect(calls.request).toBeUndefined()
})

test('fechar a orientação de lote não solicita assinatura', async ({ page }) => {
  const calls = {}
  const row = await openDocumentsCenter(page, { calls })

  await row.getByRole('button', { name:'Entrar no lote de 10' }).click()
  const dialog = page.locator('.clinical-sign-document-dialog')
  await dialog.getByRole('button', { name:'Fechar' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(row.getByRole('button', { name:'Entrar no lote de 10' })).toBeVisible()
  expect(calls.request).toBeUndefined()
})

test('recarregar durante o processamento preserva o estado pendente', async ({ page }) => {
  const calls = {}
  const row = await openDocumentsCenter(page, { calls, signatures:[signatureRow()] })
  await expect(row).toContainText('Assinatura em andamento')

  await page.reload()
  await expect(page.getByTestId('clinical-documents-center')).toBeVisible()
  const reloaded = page.locator('.clinical-documents-center-list > article').first()
  await expect(reloaded).toContainText('Assinatura em andamento')
  await expect(reloaded.getByRole('button', { name:'Acompanhar assinatura' })).toBeVisible()
})

test('atualizar status mostra o que ainda falta, sem prometer assinatura concluída', async ({ page }) => {
  const calls = {}
  const row = await openDocumentsCenter(page, {
    calls,
    signatures:[signatureRow()],
    reconcileHandler:async (route, calls2) => {
      void calls2
      await route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify({ attempt:{ id:ATTEMPT, status:'pending', evidenceGapCode:'verify_service_unavailable' } }),
      })
    },
  })

  await row.getByRole('button', { name:'Acompanhar assinatura' }).click()
  const dialog = page.locator('.clinical-sign-document-dialog')
  await dialog.getByRole('button', { name:'Atualizar status' }).click()
  await expect(dialog).toContainText('Não conseguimos confirmar agora')
  expect(calls.reconcile).toBe(1)
})

test('assinatura concluída abre o documento assinado', async ({ page }) => {
  const calls = {}
  const row = await openDocumentsCenter(page, { calls, signatures:[signatureRow({ status:'signed' })] })

  await expect(row).toContainText('Assinado')
  await row.getByRole('button', { name:'Ver assinado' }).click()
  await expect.poll(() => page.evaluate(() => window.__openedWindows.length)).toBe(1)
  expect(calls.artifact).toBe(1)
  const opened = await page.evaluate(() => window.__openedWindows)
  expect(opened.at(-1).url).toContain('https://storage.test/assinado.pdf')
  expect(opened.at(-1).features).toContain('noopener')
})

test('falha terminal permite nova tentativa e explica o motivo', async ({ page }) => {
  const calls = {}
  const row = await openDocumentsCenter(page, { calls, signatures:[signatureRow({ status:'failed' })] })
  await expect(row).toContainText('A assinatura não deu certo')

  await row.getByRole('button', { name:'Entrar no lote de 10' }).click()
  const dialog = page.locator('.clinical-sign-document-dialog')
  await expect(dialog).toContainText('A BRy exige exatamente 10 documentos por envelope')
  await dialog.getByRole('button', { name:'Voltar para a fila de 10 documentos' }).click()
  await expect(dialog).toHaveCount(0)
  expect(calls.request).toBeUndefined()
})

test('resultado desconhecido pode ser encerrado para liberar nova tentativa', async ({ page }) => {
  const calls = {}
  const row = await openDocumentsCenter(page, { calls, signatures:[signatureRow()] })

  await row.getByRole('button', { name:'Acompanhar assinatura' }).click()
  const dialog = page.locator('.clinical-sign-document-dialog')
  await dialog.getByRole('button', { name:'Encerrar tentativa' }).click()
  await expect(dialog).toHaveCount(0)
  expect(calls.abandon).toBe(1)
  await expect(row).toContainText('A assinatura não deu certo')
})

test('quem não emitiu o documento não recebe a ação de assinar', async ({ page }) => {
  const calls = {}
  const row = await openDocumentsCenter(page, {
    calls,
    documents:[documentRow({ created_by:'outro-profissional', author_name:'Dr. Outro', author_registration:'CRM-RS 9999' })],
  })

  await expect(row).toContainText('Ainda não assinado')
  await expect(row.getByRole('button', { name:'Ver assinatura' })).toBeVisible()
  await expect(row.getByRole('button', { name:'Entrar no lote de 10' })).toHaveCount(0)
})

test('a orientação individual não abre pop-up nem cria pedido', async ({ page }) => {
  const calls = {}
  const row = await openDocumentsCenter(page, { calls })

  await row.getByRole('button', { name:'Entrar no lote de 10' }).click()
  const dialog = page.locator('.clinical-sign-document-dialog')
  await expect(dialog).toContainText('Nenhum envelope foi criado para este documento individual')
  expect(await page.content()).not.toContain(SIGNING_URL)
  expect(calls.request).toBeUndefined()
  expect(await page.evaluate(() => window.__openedWindows.length)).toBe(0)
})
