import { expect, test } from '@playwright/test'

const NUMBERS = [{ id: 'n1', label: 'Concierge', phone: '5511999990000', active:true }]
const PROFILE_PHOTO = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="32"%3E%3Crect width="32" height="32" fill="%2300a884"/%3E%3C/svg%3E'
const MESSAGES = [
  { id: 'm5', phone: '120363019502650977-group', direction: 'inbound', body: 'Confirmado para amanhã', status: 'read', created_at: '2026-10-10T14:05:00Z', patient_id: null, whatsapp_number_id: 'n1', is_group: true, chat_name: 'Equipe Cirúrgica', chat_photo: PROFILE_PHOTO, sender_name: 'João Instrumentador', sender_phone: '5511966665555', sender_photo: PROFILE_PHOTO, patients: null },
  { id: 'm4', phone: '120363019502650977-group', direction: 'inbound', body: 'Materiais separados', status: 'read', created_at: '2026-10-10T14:00:00Z', patient_id: null, whatsapp_number_id: 'n1', is_group: true, chat_name: 'Equipe Cirúrgica', chat_photo: PROFILE_PHOTO, sender_name: 'Maria Enfermeira', sender_phone: '5511955554444', sender_photo: PROFILE_PHOTO, patients: null },
  { id: 'm3', phone: '5511977776666', direction: 'inbound', body: 'Quero fazer rino', status: 'read', created_at: '2026-10-10T13:00:00Z', patient_id: null, contact_id: 'c1', whatsapp_number_id: 'n1', patients: null, crm_contacts: { id:'c1', full_name:null, phone:'5511977776666', status:'contact', patient_id:null } },
  { id: 'm2', phone: '5511988887777', direction: 'outbound', body: 'Oi! Como ajudo?\nPode me contar o que procura?', status: 'read', created_at: '2026-10-10T12:05:00Z', patient_id: 'p1', whatsapp_number_id: 'n1', patients: { full_name: 'Ana Silva' } },
  { id: 'm1', phone: '5511988887777', direction: 'inbound', body: 'Oi, doutora', status: 'read', created_at: '2026-10-10T12:00:00Z', patient_id: 'p1', whatsapp_number_id: 'n1', patients: { full_name: 'Ana Silva' } },
]

const LONG_MESSAGES = [
  ...Array.from({ length: 36 }, (_, index) => ({
    id: `long-${index}`,
    phone: '5511988887777',
    direction: index % 3 === 0 ? 'outbound' : 'inbound',
    body: `Mensagem de acompanhamento ${36 - index}\nCom conteúdo suficiente para validar a rolagem do histórico.`,
    status: 'read',
    created_at: new Date(Date.UTC(2026, 9, 10, 18, 0) - index * 60_000).toISOString(),
    patient_id: 'p1',
    whatsapp_number_id: 'n1',
    patients: { full_name: 'Ana Silva' },
  })),
  ...Array.from({ length: 18 }, (_, index) => ({
    id: `contact-${index}`,
    phone: `5511977${String(index).padStart(6, '0')}`,
    direction: 'inbound',
    body: `Nova conversa ${index + 1}`,
    status: 'read',
    created_at: new Date(Date.UTC(2026, 9, 10, 16, 0) - index * 60_000).toISOString(),
    patient_id: `patient-${index}`,
    whatsapp_number_id: 'n1',
    patients: { full_name: `Contato ${String(index + 1).padStart(2, '0')}` },
  })),
]

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('surgimetrics_onboarded', 'true') } catch { /* ignore */ }
  })
  await page.route('**/rest/v1/whatsapp_messages*', route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MESSAGES) })
    return route.continue()
  })
  await page.route('**/rest/v1/whatsapp_numbers*', route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NUMBERS) })
    return route.continue()
  })
  await page.route('**/rest/v1/rpc/clinic_team*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/rest/v1/whatsapp_conversation_states*', route => route.fulfill({ status: route.request().method() === 'GET' ? 200 : 201, contentType: 'application/json', body: '[]' }))
  await page.route('**/rest/v1/whatsapp_saved_replies*', route => route.fulfill({ status: route.request().method() === 'GET' ? 200 : 201, contentType: 'application/json', body: '[]' }))
})

test('mantém lista e histórico roláveis com o compositor sempre visível', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.unroute('**/rest/v1/whatsapp_messages*')
  await page.route('**/rest/v1/whatsapp_messages*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LONG_MESSAGES) }))

  await page.goto('/app/inbox')
  await expect(page.getByPlaceholder('Responder...')).toBeVisible()
  await expect(page.locator('.wa-brand-icon [data-testid="whatsapp-brand-logo"]')).toBeVisible()

  const geometry = await page.evaluate(() => {
    const inbox = document.querySelector('.wa-inbox').getBoundingClientRect()
    const composer = document.querySelector('.wa-composer').getBoundingClientRect()
    const messages = document.querySelector('.wa-messages')
    const list = document.querySelector('.wa-conversation-list')
    return {
      inboxBottom: inbox.bottom,
      composerBottom: composer.bottom,
      viewportHeight: window.innerHeight,
      mainOverflow: getComputedStyle(document.querySelector('main[data-page="inbox"]')).overflow,
      messagesOverflow: getComputedStyle(messages).overflowY,
      messagesClientHeight: messages.clientHeight,
      messagesScrollHeight: messages.scrollHeight,
      listClientHeight: list.clientHeight,
      listScrollHeight: list.scrollHeight,
    }
  })

  expect(geometry.mainOverflow).toBe('hidden')
  expect(geometry.messagesOverflow).toBe('auto')
  expect(geometry.composerBottom).toBeLessThanOrEqual(geometry.inboxBottom + 1)
  expect(geometry.inboxBottom).toBeLessThanOrEqual(geometry.viewportHeight + 1)
  expect(geometry.messagesScrollHeight).toBeGreaterThan(geometry.messagesClientHeight)
  expect(geometry.listScrollHeight).toBeGreaterThan(geometry.listClientHeight)

  const messages = page.locator('.wa-messages')
  await messages.evaluate(element => { element.scrollTop = 0 })
  await expect.poll(() => messages.evaluate(element => element.scrollTop)).toBe(0)
  await messages.evaluate(element => { element.scrollTop = 120 })
  await expect.poll(() => messages.evaluate(element => element.scrollTop)).toBeGreaterThan(0)

  const list = page.locator('.wa-conversation-list')
  await list.evaluate(element => { element.scrollTop = 160 })
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
})

test('mantém o campo de resposta acessível no celular', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await page.unroute('**/rest/v1/whatsapp_messages*')
  await page.route('**/rest/v1/whatsapp_messages*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LONG_MESSAGES) }))

  await page.goto('/app/inbox')
  const composer = page.locator('.wa-composer')
  await expect(composer).toBeVisible()
  const box = await composer.boundingBox()
  expect(box.y + box.height).toBeLessThanOrEqual(701)
  await expect(page.locator('.wa-messages')).toHaveCSS('overflow-y', 'auto')
})

test('no celular volta para a lista e permite trocar de conversa repetidamente', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 })
  await page.goto('/app/inbox')

  await expect(page.locator('.wa-chat')).toBeVisible()
  await page.getByRole('button', { name: 'Voltar para conversas' }).click()
  await expect(page.locator('.wa-sidebar')).toBeVisible()
  await expect(page.locator('.wa-chat')).toBeHidden()

  await page.locator('.wa-conversation').filter({ hasText: 'Ana Silva' }).click()
  await expect(page.locator('.wa-chat-header')).toContainText('Ana Silva')
  await expect(page.getByText('Oi, doutora').first()).toBeVisible()

  await page.getByRole('button', { name: 'Voltar para conversas' }).click()
  await expect(page.locator('.wa-sidebar')).toBeVisible()
  await page.getByRole('button', { name: 'Grupos', exact: true }).click()
  await page.locator('.wa-conversation').filter({ hasText: 'Equipe Cirúrgica' }).click()
  await expect(page.locator('.wa-chat-header')).toContainText('Equipe Cirúrgica')
  await expect(page.locator('.wa-messages').getByText('Confirmado para amanhã', { exact: true })).toBeVisible()
})

test('inbox separa contatos de pacientes e abre os threads', async ({ page }) => {
  await page.goto('/app/inbox')
  await expect(page).toHaveURL(/\/app\/inbox$/)
  await expect(page.locator('.wa-sidebar-title').getByText('Conversas', { exact:true })).toBeVisible()

  // Paciente confirmado (Ana) e contato ainda não convertido aparecem na lista.
  const sidebar = page.locator('.wa-sidebar')
  await expect(sidebar.getByText('Ana Silva')).toBeVisible()
  await expect(sidebar.getByText('+55 (11) 97777-6666')).toBeVisible()
  await expect(sidebar.getByText('Equipe Cirúrgica')).toBeHidden()
  await expect(sidebar.locator('.wa-conversation').filter({ hasText:'+55 (11) 97777-6666' })).toContainText('Contato')

  // Abrir a conversa da Ana → thread com as duas mensagens + caixa de resposta.
  await sidebar.getByText('Ana Silva').click()
  await expect(page.getByText('Oi, doutora').first()).toBeVisible()
  const multiline = page.locator('.wa-message-text').filter({ hasText: /Oi! Como ajudo\?\s+Pode me contar o que procura\?/ })
  await expect(multiline).toBeVisible()
  await expect(multiline).toHaveCSS('white-space', 'pre-wrap')
  await expect(page.locator('[title="Lida"]')).toBeVisible()
  await expect(page.getByPlaceholder('Responder...')).toBeVisible()
  const inboundRow = page.locator('.wa-message-row').filter({ hasText: 'Oi, doutora' })
  const outboundRow = page.locator('.wa-message-row').filter({ hasText: /Oi! Como ajudo/ })
  await expect(inboundRow).toHaveClass(/inbound/)
  await expect(outboundRow).toHaveClass(/outbound/)
  const [inboundBox, outboundBox] = await Promise.all([
    inboundRow.locator('.wa-bubble').boundingBox(),
    outboundRow.locator('.wa-bubble').boundingBox(),
  ])
  expect(outboundBox.x).toBeGreaterThan(inboundBox.x)

  // Abrir o contato → dá pra responder e classificar sem criar paciente automaticamente.
  await sidebar.getByText('+55 (11) 97777-6666').click()
  await expect(page.getByText('Quero fazer rino').first()).toBeVisible()
  await expect(page.getByPlaceholder('Responder...')).toBeVisible()
  await expect(page.getByRole('button', { name:'Adicionar ao funil' })).toBeVisible()
  await expect(page.getByRole('button', { name:'Cadastrar ou vincular paciente' })).toBeVisible()
})

test('fila separa atendimentos, grupos e não lidas', async ({ page }) => {
  await page.goto('/app/inbox')
  const sidebar = page.locator('.wa-sidebar')
  await expect(sidebar.getByText('Ana Silva')).toBeVisible()
  await expect(sidebar.getByText('Equipe Cirúrgica')).toBeHidden()
  await page.getByRole('button', { name:'Grupos', exact:true }).click()
  await expect(sidebar.getByText('Equipe Cirúrgica')).toBeVisible()
  await expect(sidebar.getByText('Ana Silva')).toBeHidden()
  await page.getByRole('button', { name:'Não lidas', exact:true }).click()
  await expect(sidebar.locator('.wa-unread-badge').first()).toBeVisible()
})

test('adiciona contato ao funil sem inserir paciente', async ({ page }) => {
  let rpcPayload = null
  let patientWrites = 0
  await page.route('**/rest/v1/rpc/create_whatsapp_contact_lead*', async route => {
    rpcPayload = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ id:'opp-contact', contact_id:'c1', patient_id:null, stage:'primeiro_contato', status:'aberto' }) })
  })
  await page.route('**/rest/v1/patients*', async route => {
    if (route.request().method() !== 'GET') patientWrites += 1
    await route.fulfill({ status:200, contentType:'application/json', body:'[]' })
  })

  await page.goto('/app/inbox')
  await page.locator('.wa-sidebar').getByText('+55 (11) 97777-6666').click()
  await page.getByRole('button', { name:'Adicionar ao funil' }).click()
  await expect(page.getByText('Isso não cadastra a pessoa como paciente.')).toBeVisible()
  await page.getByPlaceholder('Ex.: Rinoplastia').fill('Rinoplastia')
  await page.getByRole('button', { name:'Adicionar ao funil', exact:true }).last().click()

  await expect.poll(() => rpcPayload).toEqual({ p_contact:'c1', p_title:'Rinoplastia' })
  expect(patientWrites).toBe(0)
})

test('converte contato em paciente somente após confirmação explícita', async ({ page }) => {
  let rpcPayload = null
  await page.route('**/rest/v1/rpc/convert_crm_contact_to_patient*', async route => {
    rpcPayload = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({ status:200, contentType:'application/json', body:'"patient-created"' })
  })
  await page.route('**/rest/v1/patients*', route => route.fulfill({ status:200, contentType:'application/json', body:'[]' }))

  await page.goto('/app/inbox')
  await page.locator('.wa-sidebar').getByText('+55 (11) 97777-6666').click()
  await page.getByRole('button', { name:'Cadastrar ou vincular paciente' }).click()
  await page.getByPlaceholder('Nome completo').fill('Maria Confirmada')
  await page.getByRole('button', { name:'Criar novo paciente' }).click()

  await expect.poll(() => rpcPayload).toEqual({ p_contact:'c1', p_name:'Maria Confirmada', p_patient:null })
})

test('reúne telefone e LID no chat correto sem misturar números da clínica', async ({ page }) => {
  const lid = '22093462769770@lid'
  const routedMessages = [
    { id:'lid-out', phone:lid, chat_lid:lid, contact_phone:'555182452361', direction:'outbound', body:'Enviada pelo celular', status:'sent', created_at:'2026-10-14T21:44:00Z', patient_id:'p-sofia', whatsapp_number_id:'n1', patients:{ full_name:'Sofia Vieira' } },
    { id:'phone-in', phone:'555182452361', chat_lid:lid, contact_phone:'555182452361', direction:'inbound', body:'Resposta da Sofia', status:'read', created_at:'2026-10-14T21:43:00Z', patient_id:'p-sofia', whatsapp_number_id:'n1', patients:{ full_name:'Sofia Vieira' } },
    { id:'other-number', phone:lid, chat_lid:lid, contact_phone:'555182452361', direction:'inbound', body:'Conversa da outra instância', status:'read', created_at:'2026-10-14T21:42:00Z', patient_id:'p-sofia', whatsapp_number_id:'n2', patients:{ full_name:'Sofia Vieira' } },
  ]
  await page.unroute('**/rest/v1/whatsapp_messages*')
  await page.route('**/rest/v1/whatsapp_messages*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(routedMessages) }))
  await page.unroute('**/rest/v1/whatsapp_numbers*')
  await page.route('**/rest/v1/whatsapp_numbers*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([
    ...NUMBERS,
    { id:'n2', label:'Pessoal', phone:'555188888888', active:true },
  ]) }))

  await page.goto('/app/inbox')
  await expect(page.locator('.wa-conversation')).toHaveCount(2)
  await expect(page.locator('.wa-messages')).toContainText('Enviada pelo celular')
  await expect(page.locator('.wa-messages')).toContainText('Resposta da Sofia')
  await expect(page.locator('.wa-messages')).not.toContainText('Conversa da outra instância')
  const outgoing = page.locator('.wa-message-row').filter({ hasText:'Enviada pelo celular' })
  await expect(outgoing).toHaveClass(/outbound/)
})

test('responde pela instância da conversa quando a clínica possui três números', async ({ page }) => {
  const threeNumbers = [
    { id:'n1', label:'Recepção', phone:'5511999990001', active:true },
    { id:'n2', label:'Comercial', phone:'5511999990002', active:true },
    { id:'n3', label:'Pós-operatório', phone:'5511999990003', active:true },
  ]
  const routedMessages = threeNumbers.map((number, index) => ({
    id:`message-${number.id}`,
    phone:'5511988887777',
    direction:'inbound',
    body:`Mensagem pela ${number.label}`,
    status:'read',
    created_at:new Date(Date.UTC(2026, 9, 14, 20, index)).toISOString(),
    patient_id:'p1',
    whatsapp_number_id:number.id,
    patients:{ full_name:'Ana Silva' },
  }))
  let sentPayload = null
  const messageScopes = []
  await page.unroute('**/rest/v1/whatsapp_messages*')
  await page.route('**/rest/v1/whatsapp_messages*', route => {
    messageScopes.push(new URL(route.request().url()).searchParams.get('whatsapp_number_id'))
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(routedMessages) })
  })
  await page.unroute('**/rest/v1/whatsapp_numbers*')
  await page.route('**/rest/v1/whatsapp_numbers*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(threeNumbers) }))
  await page.route('**/api/whatsapp?action=message', async route => {
    sentPayload = route.request().postDataJSON()
    await route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify({ ok:true, messageId:'sent-1' }) })
  })

  await page.goto('/app/inbox')
  await expect.poll(() => new Set(messageScopes.filter(Boolean)).size).toBe(4)
  await page.locator('.wa-conversation').filter({ hasText:'Pós-operatório' }).click()
  await expect(page.locator('.wa-reply-number select')).toHaveValue('n3')
  await page.getByPlaceholder('Responder...').fill('Retorno seguro')
  await page.getByRole('button', { name:'Enviar mensagem' }).click()

  await expect.poll(() => sentPayload?.whatsappNumberId).toBe('n3')
  expect(sentPayload.requestId).toMatch(/^[0-9a-f-]{36}$/i)
  expect(sentPayload.text).toBe('Retorno seguro')
})

test('preserva o histórico, mas remove números inativos ou desconectados dos seletores', async ({ page }) => {
  await page.unroute('**/rest/v1/whatsapp_numbers*')
  await page.route('**/rest/v1/whatsapp_numbers*', route => route.fulfill({
    status:200,
    contentType:'application/json',
    body:JSON.stringify([
      { ...NUMBERS[0], active:false, provider:'evolution', connection_state:'close' },
      { id:'n2', label:'Atendimento ativo', phone:'5511999990002', active:true, provider:'evolution', connection_state:'open' },
      { id:'n3', label:'Atendimento desconectado', phone:'5511999990003', active:true, provider:'evolution', connection_state:'close' },
    ]),
  }))

  await page.goto('/app/inbox')
  await expect(page.locator('.wa-conversation').filter({ hasText:'Ana Silva' })).toBeVisible()
  await page.locator('.wa-conversation').filter({ hasText:'Ana Silva' }).click()
  await expect(page.locator('.wa-messages')).toContainText('Oi, doutora')
  await expect(page.locator('.wa-reply-number select')).toHaveValue('')
  await expect(page.locator('.wa-filters select').first().locator('option')).toHaveText(['Todos os números', 'Atendimento ativo'])
  await expect(page.locator('.wa-reply-number select').locator('option')).toHaveText(['Selecione um número ativo', 'Atendimento ativo'])
})

test('grupo mostra identidade coletiva e identifica cada participante', async ({ page }) => {
  await page.goto('/app/inbox')
  await page.getByRole('button', { name:'Grupos', exact:true }).click()
  const sidebar = page.locator('.wa-sidebar')
  const groupConversation = sidebar.locator('.wa-conversation').filter({ hasText:'Equipe Cirúrgica' })
  await expect(groupConversation).toContainText('grupo')
  await expect(groupConversation).toContainText('João Instrumentador: Confirmado para amanhã')
  await expect(groupConversation.locator('.wa-avatar img')).toBeVisible()

  await groupConversation.click()
  await expect(page.locator('.wa-chat-header')).toContainText('Conversa em grupo')
  await expect(page.locator('.wa-participant-name').filter({ hasText:'Maria Enfermeira' })).toContainText('+55 (11) 95555-4444')
  await expect(page.locator('.wa-participant-name').filter({ hasText:'João Instrumentador' })).toContainText('+55 (11) 96666-5555')
  await expect(page.locator('.wa-participant-avatar img')).toHaveCount(2)
  await expect(page.locator('.wa-chat-tags')).not.toContainText('não atribuída')
})

test('grupo distingue participante por Linked ID quando nome e telefone estão ocultos', async ({ page }) => {
  await page.unroute('**/rest/v1/whatsapp_messages*')
  await page.route('**/rest/v1/whatsapp_messages*', route => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify([{
    id:'private-participant', phone:'120363019502650977-group', direction:'inbound', body:'Mensagem identificada', status:'read',
    created_at:'2026-10-14T21:00:00Z', patient_id:null, whatsapp_number_id:'n1', is_group:true,
    chat_name:'Grupo privado', sender_name:null, sender_phone:null, sender_lid:'184305754083376@lid', patients:null,
  }]) }))

  await page.goto('/app/inbox')
  await page.getByRole('button', { name:'Grupos', exact:true }).click()
  await page.locator('.wa-conversation').first().click()
  await expect(page.locator('.wa-participant-name')).toContainText('Participante • ID 083376')
  await expect(page.locator('.wa-preview')).toContainText('Participante • ID 083376: Mensagem identificada')
})

test('carrega páginas anteriores somente da conversa aberta', async ({ page }) => {
  const older = {
    id:'m0', phone:'5511988887777', direction:'inbound', body:'Mensagem antiga preservada', status:'read',
    created_at:'2026-10-09T11:00:00Z', patient_id:'p1', whatsapp_number_id:'n1', patients:{ full_name:'Ana Silva' },
  }
  await page.unroute('**/rest/v1/whatsapp_messages*')
  await page.route('**/rest/v1/whatsapp_messages*', route => {
    const cursor = new URL(route.request().url()).searchParams.get('created_at') || ''
    const body = cursor.startsWith('lt.') ? [older] : MESSAGES
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) })
  })

  await page.goto('/app/inbox')
  await page.locator('.wa-sidebar').getByText('Ana Silva').click()
  await expect(page.getByText('Mensagem antiga preservada')).toHaveCount(0)
  await page.getByRole('button', { name:'Carregar mensagens anteriores' }).click()
  await expect(page.getByText('Mensagem antiga preservada')).toBeVisible()
  await expect(page.getByText('Início do histórico salvo')).toBeVisible()
})
