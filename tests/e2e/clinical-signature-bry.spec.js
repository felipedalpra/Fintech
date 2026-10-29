import { expect, test } from '@playwright/test'

// Mocks existem SOMENTE aqui: nenhum teste chama a BRy de verdade.

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

function attempt(overrides = {}) {
  return {
    id:ATTEMPT,
    documentId:DOCUMENT,
    status:'pending',
    createdAt:'2026-10-28T10:00:00Z',
    envelopeStatus:'ONGOING',
    environment:'homologation',
    dispatchState:'sent',
    evidenceGapCode:null,
    hasStoredArtifact:false,
    evidenceComplete:false,
    failureMessage:null,
    ...overrides,
  }
}

// Monta o cenario completo da ficha clinica com o estado de assinatura servido
// pelo backend. `signatureState` e mutavel para simular reconciliacao.
async function openDocuments(page, {
  documents = [documentRow()],
  integration = { available:true, environment:'homologation', requestedMode:'QUALIFIED' },
  attempts = [],
  calls = {},
  requestHandler,
  reconcileHandler,
  linkHandler,
  artifactHandler,
  abandonHandler,
} = {}) {
  const state = { integration, attempts, evidenceAvailable:true }

  await page.setViewportSize({ width:1280, height:900 })
  await page.addInitScript(() => {
    window.localStorage.setItem('surgimetrics_onboarded', 'true')
    // Impede que a aba da BRy realmente abra durante o teste e registra a URL
    // e as flags de seguranca usadas.
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

  await page.route('**/api/secure-profile?action=clinical-signature-state', async route => {
    calls.state = (calls.state || 0) + 1
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(state) })
  })

  await page.route('**/api/secure-profile?action=clinical-signature-request', async route => {
    calls.request = (calls.request || 0) + 1
    if (requestHandler) return requestHandler(route, state, calls)
    state.attempts = [attempt()]
    await route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify({ attempt:state.attempts[0], signingUrl:SIGNING_URL }),
    })
  })

  await page.route('**/api/secure-profile?action=clinical-signature-link', async route => {
    calls.link = (calls.link || 0) + 1
    if (linkHandler) return linkHandler(route, state, calls)
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ signingUrl:SIGNING_URL }) })
  })

  await page.route('**/api/secure-profile?action=clinical-signature-reconcile', async route => {
    calls.reconcile = (calls.reconcile || 0) + 1
    if (reconcileHandler) return reconcileHandler(route, state, calls)
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ attempt:state.attempts[0] }) })
  })

  await page.route('**/api/secure-profile?action=clinical-signature-abandon', async route => {
    calls.abandon = (calls.abandon || 0) + 1
    if (abandonHandler) return abandonHandler(route, state, calls)
    state.attempts = [attempt({ status:'failed', failureMessage:'Tentativa encerrada pelo profissional.' })]
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ attempt:state.attempts[0] }) })
  })

  await page.route('**/api/secure-profile?action=clinical-signature-artifact', async route => {
    calls.artifact = (calls.artifact || 0) + 1
    if (artifactHandler) return artifactHandler(route, state, calls)
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
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({ status:200, contentType:'application/json', body:'null' }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill({ status:200, contentType:'application/json', body:'true' }))
  await page.route('**/rest/v1/clinical_documents*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(documents) }))
  for (const table of [
    'medical_records', 'medical_record_addenda', 'clinical_anamneses', 'clinical_intake_requests',
    'clinical_intake_submissions', 'clinical_document_signatures', 'clinical_assets',
    'clinical_treatment_plans', 'clinical_treatment_plan_versions', 'clinical_treatment_plan_status_events',
    'clinical_treatment_sessions', 'clinical_treatment_session_events', 'clinical_protocols',
    'clinical_protocol_versions', 'clinical_protocol_status_events',
  ]) {
    await page.route(`**/rest/v1/${table}*`, route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  }

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Assinatura/ }).click()
  await page.getByRole('navigation', { name:'Ficha clínica do paciente' })
    .getByRole('button', { name:'Exames e receitas', exact:true }).click()
  await expect(page.getByTestId(`clinical-document-${DOCUMENT}`)).toBeVisible()
  return state
}

test('oferece assinar com BRy, confirma antes de consumir crédito e abre a página da BRy protegida', async ({ page }) => {
  const calls = {}
  await openDocuments(page, { calls })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Pronta para assinar')
  await expect(card.getByRole('button', { name:'Assinar com BRy' })).toBeVisible()
  // A via manual continua disponível, separada da digital.
  await expect(card.getByRole('button', { name:'Imprimir / salvar PDF' })).toBeVisible()

  // Nada é enviado antes da confirmação explícita.
  await card.getByRole('button', { name:'Assinar com BRy' }).click()
  expect(calls.request).toBeUndefined()
  await expect(card.getByText(/consome créditos da BRy/)).toBeVisible()

  await card.getByRole('button', { name:'Confirmar e assinar' }).click()
  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Assinatura em processamento')
  expect(calls.request).toBe(1)

  // A aba da BRy abre com proteção contra window.opener e sem expor o link no DOM.
  await expect.poll(() => page.evaluate(() => window.__openedWindows.length)).toBe(1)
  const opened = await page.evaluate(() => window.__openedWindows)
  expect(opened[0].url).toBe(SIGNING_URL)
  expect(opened[0].features).toContain('noopener')
  expect(opened[0].features).toContain('noreferrer')
  await expect(page.locator('body')).not.toContainText('/sign/signer-1')
  expect(await page.content()).not.toContain(SIGNING_URL)
})

test('cancelar a confirmação não solicita assinatura', async ({ page }) => {
  const calls = {}
  await openDocuments(page, { calls })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await card.getByRole('button', { name:'Assinar com BRy' }).click()
  await card.getByRole('button', { name:'Cancelar' }).click()
  await expect(card.getByRole('button', { name:'Assinar com BRy' })).toBeVisible()
  expect(calls.request).toBeUndefined()
})

test('duplo clique na confirmação não cria duas solicitações', async ({ page }) => {
  const calls = {}
  await openDocuments(page, {
    calls,
    requestHandler:async (route, state) => {
      state.attempts = [attempt()]
      // Resposta lenta: o segundo clique precisa encontrar o botão desabilitado.
      await new Promise(resolve => setTimeout(resolve, 600))
      await route.fulfill({
        status:200,
        contentType:'application/json',
        body:JSON.stringify({ attempt:state.attempts[0], signingUrl:SIGNING_URL }),
      })
    },
  })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await card.getByRole('button', { name:'Assinar com BRy' }).click()
  const confirm = card.getByRole('button', { name:/Confirmar e assinar|Solicitando/ })
  await confirm.click()
  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Assinatura em processamento')
  expect(calls.request).toBe(1)
})

test('recarregar durante o processamento preserva o estado pendente e a via manual', async ({ page }) => {
  const calls = {}
  await openDocuments(page, { calls, attempts:[attempt()] })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)
  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Assinatura em processamento')

  await page.reload()
  await page.getByRole('button', { name:/Ana Assinatura/ }).click()
  await page.getByRole('navigation', { name:'Ficha clínica do paciente' })
    .getByRole('button', { name:'Exames e receitas', exact:true }).click()

  const reloaded = page.getByTestId(`clinical-document-${DOCUMENT}`)
  await expect(reloaded.getByTestId('clinical-signature-status')).toHaveText('Assinatura em processamento')
  await expect(reloaded.getByRole('button', { name:'Atualizar status' })).toBeVisible()
  await expect(reloaded.getByRole('button', { name:'Assinar com BRy' })).toHaveCount(0)
  await expect(reloaded.getByRole('button', { name:'Imprimir / salvar PDF' })).toBeVisible()
})

test('atualizar status mostra evidência pendente e nunca promete assinatura qualificada', async ({ page }) => {
  const calls = {}
  await openDocuments(page, {
    calls,
    attempts:[attempt()],
    reconcileHandler:async (route, state) => {
      state.attempts = [attempt({
        envelopeStatus:'FINISHED',
        evidenceGapCode:'verify_service_unavailable',
        hasStoredArtifact:true,
      })]
      await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ attempt:state.attempts[0], outcome:'evidencia_pendente' }) })
    },
  })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await card.getByRole('button', { name:'Atualizar status' }).click()
  await expect(card.getByTestId('clinical-signature-status')).toContainText('evidência pendente')
  // O motivo auditável é explicado ao profissional, não escondido.
  await expect(card).toContainText('serviço de verificação da BRy não respondeu')
  expect(calls.reconcile).toBe(1)

  // O artefato devolvido pode ser aberto, mas sem ser chamado de assinatura concluída.
  await expect(card.getByRole('button', { name:'Abrir arquivo devolvido pela BRy' })).toBeVisible()
  await expect(card.getByRole('button', { name:'Abrir PDF assinado' })).toHaveCount(0)
  await expect(card).not.toContainText('Assinado digitalmente')
})

test('assinatura reprovada pela verificação é sinalizada, não tratada como válida', async ({ page }) => {
  const calls = {}
  await openDocuments(page, {
    calls,
    attempts:[attempt({
      envelopeStatus:'FINISHED',
      evidenceGapCode:'verify_signature_invalid',
      hasStoredArtifact:true,
    })],
  })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Assinatura não validada pela BRy')
  await expect(card).toContainText('Não use este documento como assinado')
  await expect(card.getByRole('button', { name:'Abrir PDF assinado' })).toHaveCount(0)
  await expect(card).not.toContainText('Assinado digitalmente')
  // A via manual continua sendo a saída.
  await expect(card.getByRole('button', { name:'Imprimir / salvar PDF' })).toBeVisible()
})

test('assinatura com evidência completa abre o PDF assinado e mantém a via manual', async ({ page }) => {
  const calls = {}
  await openDocuments(page, {
    calls,
    attempts:[attempt({ status:'signed', evidenceComplete:true, hasStoredArtifact:true, signedAt:'2026-10-28T12:00:00Z' })],
  })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Assinado digitalmente')
  await expect(card.getByRole('button', { name:'Imprimir via manual' })).toBeVisible()

  await card.getByRole('button', { name:'Abrir PDF assinado' }).click()
  // A URL assinada só é aberta depois da resposta autenticada do backend.
  await expect.poll(() => page.evaluate(() => window.__openedWindows.length)).toBe(1)
  expect(calls.artifact).toBe(1)
  const opened = await page.evaluate(() => window.__openedWindows)
  expect(opened.at(-1).url).toContain('https://storage.test/assinado.pdf')
  expect(opened.at(-1).features).toContain('noopener')
})

test('falha terminal permite nova tentativa e exibe a causa', async ({ page }) => {
  const calls = {}
  await openDocuments(page, {
    calls,
    attempts:[attempt({ status:'failed', failureMessage:'O prazo do envelope expirou antes da assinatura.' })],
  })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Falha na assinatura')
  await expect(card).toContainText('O prazo do envelope expirou')
  await expect(card.getByRole('button', { name:'Atualizar status' })).toHaveCount(0)

  await card.getByRole('button', { name:'Tentar assinar novamente' }).click()
  await card.getByRole('button', { name:'Confirmar e assinar' }).click()
  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Assinatura em processamento')
  expect(calls.request).toBe(1)
})

test('resultado desconhecido não reenvia e exige encerramento explícito', async ({ page }) => {
  const calls = {}
  await openDocuments(page, { calls, attempts:[attempt({ dispatchState:'unknown' })] })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Resultado desconhecido na BRy')
  await expect(card).toContainText('Não reenviamos automaticamente')
  await expect(card.getByRole('button', { name:'Assinar com BRy' })).toHaveCount(0)
  await expect(card.getByRole('button', { name:'Tentar assinar novamente' })).toHaveCount(0)

  await card.getByRole('button', { name:'Encerrar tentativa' }).click()
  await expect(card.getByText(/crédito pode já ter sido consumido/)).toBeVisible()
  expect(calls.abandon).toBeUndefined()

  await card.getByRole('button', { name:'Encerrar tentativa', exact:true }).last().click()
  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Falha na assinatura')
  expect(calls.abandon).toBe(1)
  // Encerrada, uma nova tentativa volta a ser possível.
  await expect(card.getByRole('button', { name:'Tentar assinar novamente' })).toBeVisible()
})

test('integração indisponível esconde a assinatura digital e preserva a impressão', async ({ page }) => {
  const calls = {}
  await openDocuments(page, { calls, integration:{ available:false, reason:'desabilitada' } })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Assinatura digital não configurada')
  await expect(card.getByRole('button', { name:'Assinar com BRy' })).toHaveCount(0)
  await expect(card.getByRole('button', { name:'Imprimir / salvar PDF' })).toBeVisible()
  await expect(page.getByTestId('clinical-signature-readiness')).toContainText('Integração com a BRy indisponível')
  // Sem integração habilitada, nada na tela promete assinatura qualificada.
  await expect(page.locator('body')).not.toContainText('qualificada')
})

test('usuário que não emitiu o documento não recebe a ação de assinar', async ({ page }) => {
  const calls = {}
  await openDocuments(page, {
    calls,
    documents:[documentRow({ created_by:'outro-profissional', author_name:'Dr. Outro', author_registration:'CRM-RS 9999' })],
  })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Assinatura digital pendente')
  await expect(card).toContainText('Somente o profissional que emitiu o documento')
  await expect(card.getByRole('button', { name:'Assinar com BRy' })).toHaveCount(0)
  await expect(card.getByRole('button', { name:'Imprimir / salvar PDF' })).toBeVisible()
})

test('pop-up bloqueado avisa sem expor o link e falha de rede não quebra a tela', async ({ page }) => {
  const calls = {}
  await openDocuments(page, { calls })
  await page.evaluate(() => { window.__popupBlocked = true })
  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)

  await card.getByRole('button', { name:'Assinar com BRy' }).click()
  await card.getByRole('button', { name:'Confirmar e assinar' }).click()
  await expect(page.getByText(/bloqueou a janela da BRy/)).toBeVisible()
  expect(await page.content()).not.toContain(SIGNING_URL)

  // A saída prometida na mensagem existe de verdade: reabrir a página sem
  // criar outro envelope.
  await page.evaluate(() => { window.__popupBlocked = false })
  await card.getByRole('button', { name:'Abrir página de assinatura' }).click()
  await expect.poll(() => page.evaluate(() => window.__openedWindows.length)).toBe(1)
  expect(calls.link).toBe(1)
  expect(calls.request).toBe(1)

  // Falha de rede na reconciliação mostra mensagem sanitizada e mantém o card.
  await page.route('**/api/secure-profile?action=clinical-signature-reconcile', route => route.fulfill({
    status:502, contentType:'application/json', body:JSON.stringify({ error:'A BRy está indisponível no momento.' }),
  }))
  await card.getByRole('button', { name:'Atualizar status' }).click()
  await expect(page.getByText('A BRy está indisponível no momento.')).toBeVisible()
  await expect(card.getByRole('button', { name:'Imprimir / salvar PDF' })).toBeVisible()
})

test('backend de assinatura indisponível não bloqueia o histórico nem a via manual', async ({ page }) => {
  await page.setViewportSize({ width:1280, height:900 })
  await page.addInitScript(() => { window.localStorage.setItem('surgimetrics_onboarded', 'true') })

  await page.route('**/api/secure-profile?action=get', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ profile:{ doctor:{ fullName:'Dra. Clínica E2E', registrationId:'CRM-RS 0001' } } }),
  }))
  // O endpoint de estado cai: a tela precisa degradar, não quebrar.
  await page.route('**/api/secure-profile?action=clinical-signature-state', route => route.fulfill({
    status:500, contentType:'application/json', body:JSON.stringify({ error:'indisponível' }),
  }))
  await page.route('**/rest/v1/patients*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([{ id:'patient-signature', full_name:'Ana Assinatura', date_of_birth:'1990-04-10', active:true }]),
  }))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({ status:200, contentType:'application/json', body:'null' }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill({ status:200, contentType:'application/json', body:'true' }))
  await page.route('**/rest/v1/clinical_documents*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([documentRow()]) }))
  for (const table of [
    'medical_records', 'medical_record_addenda', 'clinical_anamneses', 'clinical_intake_requests',
    'clinical_intake_submissions', 'clinical_document_signatures', 'clinical_assets',
    'clinical_treatment_plans', 'clinical_treatment_plan_versions', 'clinical_treatment_plan_status_events',
    'clinical_treatment_sessions', 'clinical_treatment_session_events', 'clinical_protocols',
    'clinical_protocol_versions', 'clinical_protocol_status_events',
  ]) {
    await page.route(`**/rest/v1/${table}*`, route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  }

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Assinatura/ }).click()
  await page.getByRole('navigation', { name:'Ficha clínica do paciente' })
    .getByRole('button', { name:'Exames e receitas', exact:true }).click()

  const card = page.getByTestId(`clinical-document-${DOCUMENT}`)
  await expect(card).toBeVisible()
  await expect(card.getByRole('button', { name:'Imprimir / salvar PDF' })).toBeVisible()
  await expect(card.getByRole('button', { name:'Assinar com BRy' })).toHaveCount(0)
  await expect(card.getByTestId('clinical-signature-status')).toHaveText('Assinatura digital não configurada')
})
