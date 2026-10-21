import { expect, test } from '@playwright/test'

test('abre a agenda do dia e mantém todos os módulos na ficha clínica', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  await page.addInitScript(() => {
    const local = new Date()
    const date = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
    window.sessionStorage.setItem('surgimetrics_workspace_draft_e2e-user-id', JSON.stringify({
      consultations:[{
        id:'consultation-agenda',
        patient:'Ana Agenda',
        patientId:'patient-agenda',
        date,
        startTime:'09:30',
        durationMinutes:45,
        consultationType:'avaliacao',
        paymentStatus:'pendente',
      }],
    }))
    window.localStorage.setItem('surgimetrics_onboarded', 'true')
  })
  await page.route('**/api/secure-profile?action=get', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ profile:{ doctor:{ fullName:'Dra. Clínica E2E', registrationId:'CRM-E2E 0001' } } }) }))
  await page.route('**/rest/v1/patients*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([{ id:'patient-agenda', full_name:'Ana Agenda', date_of_birth:'1990-04-10', phone:'11999990000', active:true }]) }))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ patient_id:'patient-agenda', user_id:'e2e-user-id', allergies:'Dipirona', consent_signed:false }) }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill({ status:200, contentType:'application/json', body:'true' }))
  await page.route('**/rest/v1/medical_records*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/medical_record_addenda*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/clinical_documents*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))

  await page.goto('/app/clinical-records')
  await expect(page.getByTestId('clinical-day-agenda')).toBeVisible({ timeout:10000 })
  await expect(page.getByRole('button', { name:/09:30.*Ana Agenda.*Avaliação/ })).toBeVisible()
  await page.getByRole('button', { name:/09:30.*Ana Agenda.*Avaliação/ }).click()

  await expect(page.getByRole('heading', { name:'Ana Agenda' })).toBeVisible()
  await expect(page.getByText('Alergias: Dipirona')).toBeVisible()
  await expect(page.getByRole('navigation', { name:'Ficha clínica do paciente' })).toContainText('Exames e receitas')
  await page.getByRole('button', { name:/Exames e receitas/ }).click()
  await expect(page.getByText('Nenhum documento emitido')).toBeVisible()
})

test('emite pedido de exames e receita simples no histórico clínico', async ({ page }) => {
  const documents = []
  const rpcPayloads = []

  await page.setViewportSize({ width:390, height:844 })

  await page.route('**/api/secure-profile?action=get', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ profile:{
      doctor:{ fullName:'Dra. Clínica E2E', registrationId:'CRM-RS 0001', phone:'51999990000', email:'medica@clinica.test' },
      clinic:{ tradeName:'Clínica E2E', addressLine:'Av. Clínica, 100', city:'Porto Alegre', state:'RS', logoDataUrl:'data:image/png;base64,logo-e2e' },
    } }),
  }))
  await page.route('**/rest/v1/patients*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([{
      id:'patient-documents',
      full_name:'Ana Documentos',
      cpf:'123.456.789-00',
      date_of_birth:'1990-04-10',
      address_street:'Rua Paciente',
      address_number:'25',
      address_city:'Porto Alegre',
      address_state:'RS',
      address_zip:'90000-000',
      active:true,
    }]),
  }))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({ status:200, contentType:'application/json', body:'null' }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill({ status:200, contentType:'application/json', body:'true' }))
  await page.route('**/rest/v1/medical_records*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/medical_record_addenda*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/clinical_documents*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(documents) }))
  await page.route('**/rest/v1/clinical_document_signatures*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/rpc/create_clinical_document*', async route => {
    const payload = await route.request().postDataJSON()
    rpcPayloads.push(payload)
    const id = `document-${documents.length + 1}`
    documents.unshift({
      id,
      user_id:'e2e-user-id',
      patient_id:'patient-documents',
      document_type:payload.p_document_type,
      issue_date:payload.p_issue_date,
      document_data:payload.p_document_data,
      patient_name:'Ana Documentos',
      patient_cpf:'123.456.789-00',
      patient_address:'Rua Paciente, 25 · Porto Alegre / RS · CEP 90000-000',
      author_name:'Dra. Clínica E2E',
      author_registration:'CRM-RS 0001',
      author_council:'CRM',
      issuer_contact:payload.p_issuer_contact,
      issuer_address:payload.p_issuer_address,
      clinic_name:payload.p_clinic_name,
      clinic_logo_data_url:payload.p_clinic_logo_data_url,
      request_id:payload.p_request_id,
      created_at:'2026-10-20T12:00:00Z',
    })
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(id) })
  })

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Documentos/ }).click()
  await page.getByRole('button', { name:'Exames e receitas' }).click()

  await page.getByRole('button', { name:'+ Pedido de exames' }).click()
  await page.getByLabel('Exames solicitados *').fill('Hemograma completo\nCoagulograma')
  await page.getByLabel('Indicação clínica').fill('Avaliação pré-operatória')
  await page.getByLabel('Telefone ou e-mail profissional *').fill('medica@clinica.test')
  await page.getByLabel('Endereço profissional *').fill('Av. Clínica, 100 — Porto Alegre/RS')
  await page.getByRole('button', { name:'Emitir documento' }).click()

  await expect(page.getByText('Hemograma completo, Coagulograma')).toBeVisible()
  await expect(page.getByText('Assinatura digital não configurada')).toBeVisible()
  expect(rpcPayloads[0]).not.toHaveProperty('p_author_name')
  expect(rpcPayloads[0]).not.toHaveProperty('p_patient_name')
  expect(rpcPayloads[0].p_clinic_logo_data_url).toBe('data:image/png;base64,logo-e2e')

  await page.getByRole('button', { name:'+ Receita simples' }).click()
  await page.getByLabel('Medicamento 1 *').fill('Dipirona')
  await page.getByLabel('Apresentação 1').fill('500 mg')
  await page.getByLabel('Quantidade 1').fill('1 caixa')
  await page.getByLabel('Modo de usar 1 *').fill('Tomar um comprimido por via oral a cada oito horas por três dias.')
  await page.getByText('Confirmo que esta receita não contém medicamento controlado nem sujeito à retenção.').click()
  await page.getByLabel('Telefone ou e-mail profissional *').fill('medica@clinica.test')
  await page.getByLabel('Endereço profissional *').fill('Av. Clínica, 100 — Porto Alegre/RS')
  await page.getByRole('button', { name:'Emitir documento' }).click()

  await expect(page.getByText(/Dipirona — 500 mg — Tomar um comprimido/)).toBeVisible()
  await expect(page.getByText('2 no histórico')).toBeVisible()
  expect(rpcPayloads[1].p_document_data).toMatchObject({ simple_prescription_confirmed:true })
})

test('assina evolução imutável e corrige somente por adendo', async ({ page }) => {
  const records = []
  const addenda = []
  const auditActions = []

  await page.route('**/rest/v1/patients*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([{ id:'patient-1', full_name:'Ana Prontuário', date_of_birth:'1991-02-03', active:true, start_date:'2026-01-10' }]),
  }))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', async route => {
    auditActions.push((await route.request().postDataJSON()).p_action)
    await route.fulfill({ status:200, contentType:'application/json', body:'true' })
  })
  await page.route('**/rest/v1/rpc/create_clinical_record*', async route => {
    const payload = await route.request().postDataJSON()
    expect(payload).not.toHaveProperty('p_author_name')
    records.unshift({
      id:'record-1',
      user_id:'e2e-user-id',
      patient_id:payload.p_patient_id,
      created_by:'e2e-user-id',
      session_date:payload.p_session_date,
      evolution_notes:payload.p_evolution_notes,
      procedures_applied:payload.p_procedures_applied,
      next_appointment_date:payload.p_next_appointment_date,
      professional_name:'Dra. Clínica E2E',
      author_name:'Dra. Clínica E2E',
      author_registration:'CRM-E2E 0001',
      author_council:'CRM',
      authorship_source:'authenticated_user',
      archived:false,
      recorded_at:'2026-10-16T12:00:00Z',
    })
    auditActions.push('create_record')
    await route.fulfill({ status:200, contentType:'application/json', body:'"record-1"' })
  })
  await page.route('**/rest/v1/rpc/create_medical_record_addendum*', async route => {
    const payload = await route.request().postDataJSON()
    expect(payload).not.toHaveProperty('p_author_name')
    addenda.push({
      id:'addendum-1',
      user_id:'e2e-user-id',
      record_id:payload.p_record_id,
      addendum_text:payload.p_addendum_text,
      author_name:'Dra. Clínica E2E',
      author_registration:'CRM-E2E 0001',
      author_council:'CRM',
      created_at:'2026-10-16T12:05:00Z',
    })
    auditActions.push('create_addendum')
    await route.fulfill({ status:200, contentType:'application/json', body:'"addendum-1"' })
  })
  await page.route('**/rest/v1/medical_records*', async route => {
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(records) })
  })
  await page.route('**/rest/v1/medical_record_addenda*', async route => {
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(addenda) })
  })

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Prontuário/ }).click()
  await expect(page.getByText('0 evoluções registradas')).toBeVisible()
  await expect(page.getByText('Nenhuma evolução registrada.')).toBeVisible()
  expect(auditActions.filter(action => action === 'view_record')).toHaveLength(1)

  await page.getByRole('button', { name:'+ Nova evolução' }).click()
  await page.getByPlaceholder('Anamnese do atendimento, exame, hipóteses, conduta e evolução…').fill('Paciente estável, sem intercorrências.')
  await page.getByRole('button', { name:'Assinar evolução' }).click()

  await expect(page.getByText('1 evolução registrada')).toBeVisible()
  await expect(page.getByText('Paciente estável, sem intercorrências.')).toBeVisible()
  await expect(page.getByRole('button', { name:'Editar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Excluir' })).toHaveCount(0)

  await page.getByRole('button', { name:'+ Adendo' }).click()
  await page.getByPlaceholder('Descreva a correção ou informação complementar…').fill('Complemento sem alterar a evolução original.')
  await page.getByRole('button', { name:'Registrar adendo' }).click()

  await expect(page.getByRole('heading', { name:'Adicionar adendo' })).toHaveCount(0)
  await expect(page.getByText('Complemento sem alterar a evolução original.')).toBeVisible()
  expect(auditActions).toEqual(['view_record', 'create_record', 'create_addendum'])
})

test('registra anamnese SOAP versionada com sinais vitais e autoria do servidor', async ({ page }) => {
  const anamneses = []
  const rpcPayloads = []
  let failNextList = false

  await page.route('**/api/secure-profile?action=get', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ profile:{ doctor:{ fullName:'Dra. Clínica E2E', registrationId:'0001' } } }),
  }))
  await page.route('**/rest/v1/patients*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([{ id:'patient-soap', full_name:'Ana SOAP', date_of_birth:'1991-02-03', active:true }]),
  }))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify({ patient_id:'patient-soap', user_id:'e2e-user-id', allergies:'Dipirona', consent_signed:false }),
  }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill({ status:200, contentType:'application/json', body:'true' }))
  await page.route('**/rest/v1/medical_records*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/medical_record_addenda*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))
  await page.route('**/rest/v1/clinical_anamneses*', route => {
    if (failNextList) {
      failNextList = false
      return route.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ message:'Falha simulada após assinatura' }) })
    }
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(anamneses) })
  })
  await page.route('**/rest/v1/rpc/create_clinical_anamnesis*', async route => {
    const rpcPayload = await route.request().postDataJSON()
    rpcPayloads.push(rpcPayload)
    const existing = anamneses.find(item => item.request_id === rpcPayload.p_request_id)
    if (existing) return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(existing.id) })
    const id = `anamnesis-${anamneses.length + 1}`
    anamneses.unshift({
      id,
      user_id:'e2e-user-id',
      patient_id:rpcPayload.p_patient_id,
      request_id:rpcPayload.p_request_id,
      session_date:rpcPayload.p_session_date,
      ...rpcPayload.p_anamnesis,
      author_name:'Dra. Clínica E2E',
      author_registration:'0001',
      author_council:'CRM',
      recorded_at:`2026-10-17T12:0${anamneses.length}:00Z`,
    })
    if (anamneses.length === 1) failNextList = true
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(id) })
  })

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana SOAP/ }).click()
  await page.getByRole('button', { name:'Anamnese' }).click()
  await expect(page.getByText('Dados legados — ainda não assinados neste formato')).toBeVisible()
  await expect(page.locator('.clinical-legacy-alerts').getByText('Alergias:', { exact:true })).toBeVisible()
  await page.getByRole('button', { name:'Completar anamnese' }).click()

  await page.getByLabel('Queixa principal *').fill('Avaliação pré-operatória')
  await page.getByLabel('História da doença atual *').fill('Sem sintomas atuais.')
  await page.getByLabel('PA sistólica').fill('120')
  await page.getByLabel('PA diastólica').fill('80')
  await page.getByLabel('Peso').fill('60.5')
  await page.getByLabel('Altura').fill('165')
  await page.getByLabel('Exame físico *').fill('Bom estado geral, eupneica.')
  await page.getByLabel('Hipóteses diagnósticas *').fill('Paciente clinicamente estável.')
  await page.getByLabel('Plano terapêutico *').fill('Solicitar exames pré-operatórios.')
  await page.getByRole('button', { name:'Assinar anamnese' }).click()

  await expect(page.getByText('A anamnese foi assinada, mas a lista de versões não pôde ser atualizada. Recarregue antes de registrar outra versão.')).toBeVisible()
  expect(rpcPayloads).toHaveLength(1)
  await page.getByRole('button', { name:'Tentar carregar novamente' }).click()
  await expect(page.getByText('Última versão assinada')).toBeVisible()
  await expect(page.getByText('Avaliação pré-operatória')).toBeVisible()
  await expect(page.getByText('22.2')).toBeVisible()
  await expect(page.getByRole('button', { name:'+ Nova versão' })).toBeVisible()
  expect(rpcPayloads[0]).toMatchObject({
    p_patient_id:'patient-soap',
    p_anamnesis:{ systolic_bp:120, diastolic_bp:80, weight_kg:60.5, height_cm:165 },
  })
  expect(rpcPayloads[0].p_request_id).toMatch(/^[0-9a-f-]{36}$/)
  expect(rpcPayloads[0]).not.toHaveProperty('p_author_name')

  await page.getByRole('button', { name:'+ Nova versão' }).click()
  await page.getByLabel('Queixa principal *').fill('Retorno pós-operatório')
  await page.getByRole('button', { name:'Assinar anamnese' }).click()
  await expect(page.getByText('Retorno pós-operatório')).toBeVisible()
  await expect(page.getByLabel('Versão da anamnese')).toBeVisible()
  expect(rpcPayloads).toHaveLength(2)
  expect(rpcPayloads[1].p_request_id).not.toBe(rpcPayloads[0].p_request_id)

  await page.getByLabel('Versão da anamnese').selectOption('anamnesis-1')
  await expect(page.getByText('Versão anterior assinada')).toBeVisible()
  await expect(page.getByText('Avaliação pré-operatória')).toBeVisible()
})

test('mantém o prontuário disponível e não informa ausência de alertas quando a anamnese falha', async ({ page }) => {
  const auditActions = []
  await page.route('**/rest/v1/patients*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([{ id:'patient-profile-error', full_name:'Ana Perfil', active:true }]),
  }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', async route => {
    auditActions.push((await route.request().postDataJSON()).p_action)
    await route.fulfill({ status:200, contentType:'application/json', body:'true' })
  })
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill({
    status:500,
    contentType:'application/json',
    body:JSON.stringify({ message:'Falha simulada no perfil clínico' }),
  }))
  await page.route('**/rest/v1/medical_records*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Perfil/ }).click()

  await expect(page.getByText('Alertas indisponíveis')).toBeVisible()
  await expect(page.getByText('Sem alertas registrados')).toHaveCount(0)
  await expect(page.getByText('Nenhuma evolução registrada.')).toBeVisible()
  expect(auditActions).toEqual(['view_record'])
})

test('não libera dados clínicos quando a auditoria da abertura falha', async ({ page }) => {
  let medicalRecordRequests = 0
  let profileRequests = 0
  await page.route('**/rest/v1/patients*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([{ id:'patient-audit-error', full_name:'Ana Auditoria', active:true }]),
  }))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill({
    status:500,
    contentType:'application/json',
    body:JSON.stringify({ message:'Falha simulada na auditoria' }),
  }))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => {
    profileRequests += 1
    return route.fulfill({ status:200, contentType:'application/json', body:'null' })
  })
  await page.route('**/rest/v1/medical_records*', route => {
    medicalRecordRequests += 1
    return route.fulfill({ status:200, contentType:'application/json', body:'[]' })
  })

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Auditoria/ }).click()

  await expect(page.getByText('Os dados clínicos não foram abertos porque a auditoria não pôde ser confirmada.')).toBeVisible()
  await expect(page.getByRole('navigation', { name:'Ficha clínica do paciente' })).toHaveCount(0)
  expect(profileRequests).toBe(0)
  expect(medicalRecordRequests).toBe(0)
})
