import XLSXStyle from 'xlsx-js-style'
import { EXPORT_TIME_ZONE, filterRowsByPeriod, resolveExportPeriod } from './exportPeriod.js'

const PAGE_SIZE = 1000
const MAX_ROWS_PER_SHEET = 200000
const MAX_CELL_LENGTH = 32760

const COLORS = {
  navy:'10233F',
  blue:'2563EB',
  paleBlue:'DBEAFE',
  paleGray:'F3F4F6',
  gray:'64748B',
  white:'FFFFFF',
  green:'047857',
  paleGreen:'D1FAE5',
  red:'B91C1C',
  paleRed:'FEE2E2',
}

const FONT = { name:'Calibri', sz:11 }
const STYLES = {
  title:{ font:{ ...FONT, bold:true, sz:16, color:{ rgb:COLORS.white } }, fill:{ fgColor:{ rgb:COLORS.navy } }, alignment:{ vertical:'center' } },
  subtitle:{ font:{ ...FONT, italic:true, color:{ rgb:COLORS.gray } }, alignment:{ vertical:'center' } },
  section:{ font:{ ...FONT, bold:true, color:{ rgb:COLORS.navy } }, fill:{ fgColor:{ rgb:COLORS.paleBlue } } },
  header:{ font:{ ...FONT, bold:true, color:{ rgb:COLORS.white } }, fill:{ fgColor:{ rgb:COLORS.blue } }, alignment:{ horizontal:'center', vertical:'center', wrapText:true }, border:{ bottom:{ style:'thin', color:{ rgb:'1D4ED8' } } } },
  text:{ font:{ ...FONT }, alignment:{ vertical:'top', wrapText:true } },
  alternate:{ font:{ ...FONT }, fill:{ fgColor:{ rgb:'F8FAFC' } }, alignment:{ vertical:'top', wrapText:true } },
  number:{ font:{ ...FONT }, numFmt:'#,##0.00' },
  integer:{ font:{ ...FONT }, numFmt:'#,##0' },
  currency:{ font:{ ...FONT }, numFmt:'R$ #,##0.00;[Red]-R$ #,##0.00' },
  warning:{ font:{ ...FONT, color:{ rgb:COLORS.red } }, fill:{ fgColor:{ rgb:COLORS.paleRed } }, alignment:{ vertical:'top', wrapText:true } },
  success:{ font:{ ...FONT, color:{ rgb:COLORS.green } }, fill:{ fgColor:{ rgb:COLORS.paleGreen } } },
}

const LOCAL_SOURCES = [
  local('procedures', 'Procedimentos', ['plans']),
  local('surgeries', 'Cirurgias', ['sales', 'calendar'], ['date', 'competenceDate', 'created_at']),
  local('consultations', 'Consultas', ['consultations', 'calendar'], ['date', 'competenceDate', 'created_at']),
  local('products', 'Produtos', ['products']),
  local('productSales', 'Vendas de produtos', ['products'], ['saleDate', 'competenceDate', 'created_at']),
  local('productPurchases', 'Compras de produtos', ['products'], ['purchaseDate', 'competenceDate', 'created_at']),
  local('extraRevenues', 'Receitas extras', ['finance', 'cashflow', 'dre'], ['competenceDate', 'date', 'dueDate', 'created_at']),
  local('expenses', 'Despesas', ['finance', 'cashflow', 'dre'], ['competenceDate', 'dueDate', 'paymentDate', 'created_at']),
  local('assets', 'Ativos', ['finance', 'balance'], ['date', 'acquisitionDate', 'created_at']),
  local('liabilities', 'Passivos', ['finance', 'balance'], ['date', 'dueDate', 'created_at']),
  local('goals', 'Metas', ['goals'], ['dueDate', 'created_at']),
  local('chartAccounts', 'Plano de contas', ['chart-of-accounts']),
]

const DEFAULT_REMOTE_DATE_FIELDS = [
  'date_start', 'date', 'competence_date', 'transaction_date', 'recorded_at', 'occurred_at',
  'start_date', 'due_date', 'payment_date', 'settlement_date', 'sale_date', 'purchase_date',
  'scheduled_at', 'sent_at', 'timestamp', 'changed_at', 'accepted_at', 'signed_at',
  'submitted_at', 'completed_at', 'issued_at', 'imported_at', 'connected_at', 'created_at', 'updated_at',
]

const REMOTE_SOURCES = [
  remote('patients', 'patients', 'Pacientes', ['patients', 'clinical-records']),
  remote('recurrences', 'recorrencias', 'Recorrências', ['recurrences']),
  remote('suppliers', 'suppliers', 'Fornecedores', ['products', 'finance']),

  remote('crmContacts', 'crm_contacts', 'Contatos CRM', ['funnel', 'crm-painel']),
  remote('opportunities', 'opportunities', 'Oportunidades', ['funnel', 'crm-painel', 'meu-dia']),
  remote('opportunityHistory', 'opportunity_stage_history', 'Histórico do funil', ['funnel', 'crm-painel']),
  remote('opportunityNotes', 'opportunity_notes', 'Notas de oportunidades', ['funnel']),
  remote('crmContactNotes', 'crm_contact_notes', 'Notas de contatos', ['funnel', 'crm-painel']),
  remote('tasks', 'tasks', 'Tarefas', ['tarefas', 'meu-dia']),

  remote('financialAccounts', 'financial_accounts', 'Contas financeiras', ['finance', 'cashflow', 'balance']),
  remote('financialEntries', 'financial_entries', 'Razão financeiro', ['finance', 'cashflow', 'dre', 'balance', 'ledger-check']),
  remote('financialInstallments', 'financial_installments', 'Parcelas financeiras', ['finance', 'cashflow', 'ledger-check']),
  remote('bankImports', 'bank_statement_imports', 'Importações bancárias', ['bank-reconciliation', 'financial-import']),
  remote('bankLines', 'bank_statement_lines', 'Linhas de extrato', ['bank-reconciliation', 'financial-import']),
  remote('bankReconciliations', 'bank_reconciliations', 'Conciliações bancárias', ['bank-reconciliation']),

  remote('medicalRecords', 'medical_records', 'Prontuários', ['clinical-records']),
  remote('recordAddenda', 'medical_record_addenda', 'Adendos clínicos', ['clinical-records']),
  remote('clinicalProfiles', 'patient_clinical_profiles', 'Perfis clínicos', ['patients', 'clinical-records'], { orderBy:'patient_id' }),
  remote('anamneses', 'clinical_anamneses', 'Anamneses', ['clinical-records']),
  remote('intakeTemplates', 'clinical_intake_templates', 'Modelos de anamnese', ['clinical-records']),
  remote('intakeRequests', 'clinical_intake_requests', 'Solicitações de anamnese', ['clinical-records']),
  remote('intakeSubmissions', 'clinical_intake_submissions', 'Respostas de anamnese', ['clinical-records']),
  remote('consentTemplates', 'clinical_consent_templates', 'Modelos de consentimento', ['clinical-records']),
  remote('consentAcceptances', 'clinical_consent_acceptances', 'Aceites de consentimento', ['clinical-records']),
  remote('clinicalDocuments', 'clinical_documents', 'Documentos clínicos', ['clinical-records']),
  remote('documentSignatures', 'clinical_document_signatures', 'Assinaturas de documentos', ['clinical-records']),
  remote('signatureConnections', 'clinical_signature_connections', 'Status da assinatura', ['clinical-records'], {
    select:'id,user_id,professional_user_id,provider,signing_mode,status,professional_name,professional_registration,professional_council,certificate_subject,certificate_serial,certificate_issuer,certificate_valid_from,certificate_valid_until,last_error_code,last_error_message,created_at,updated_at',
  }),
  remote('treatmentPlans', 'clinical_treatment_plans', 'Planos terapêuticos', ['clinical-records']),
  remote('treatmentPlanVersions', 'clinical_treatment_plan_versions', 'Versões de planos', ['clinical-records']),
  remote('treatmentPlanStatus', 'clinical_treatment_plan_status_events', 'Status dos planos', ['clinical-records']),
  remote('treatmentSessions', 'clinical_treatment_sessions', 'Sessões terapêuticas', ['clinical-records']),
  remote('treatmentSessionEvents', 'clinical_treatment_session_events', 'Eventos das sessões', ['clinical-records']),
  remote('clinicalProtocols', 'clinical_protocols', 'Protocolos clínicos', ['clinical-records']),
  remote('clinicalProtocolVersions', 'clinical_protocol_versions', 'Versões de protocolos', ['clinical-records']),
  remote('clinicalProtocolStatus', 'clinical_protocol_status_events', 'Status dos protocolos', ['clinical-records']),
  remote('clinicalAssets', 'clinical_assets', 'Arquivos clínicos', ['clinical-records']),
  remote('patientDocuments', 'patient_documents', 'Documentos de pacientes', ['clinical-records']),

  remote('whatsappMessages', 'whatsapp_messages', 'Mensagens WhatsApp', ['inbox']),
  remote('whatsappNumbers', 'whatsapp_numbers', 'Números WhatsApp', ['inbox'], {
    select:'id,user_id,label,phone,active,created_at,assigned_user_id,provider,provider_instance_name,connection_state,connected_at,last_health_at,last_webhook_at,last_webhook_event,webhook_verified_at',
    fallbackSelect:'id,user_id,label,phone,active,created_at',
  }),
  remote('whatsappStates', 'whatsapp_conversation_states', 'Conversas WhatsApp', ['inbox']),
  remote('savedReplies', 'whatsapp_saved_replies', 'Respostas rápidas', ['inbox']),
  remote('whatsappAutomations', 'whatsapp_automations', 'Automações WhatsApp', ['inbox']),
  remote('followupRules', 'followup_rules', 'Réguas de follow-up', ['funnel', 'inbox']),

  remote('metaConnections', 'meta_connections', 'Conexão Meta', ['ads'], {
    select:'id,user_id,ad_account_id,page_id,status,token_expires_at,created_at,updated_at',
  }),
  remote('metaCampaigns', 'meta_campaigns', 'Campanhas Meta', ['ads']),
  remote('metaAdsets', 'meta_adsets', 'Conjuntos Meta', ['ads']),
  remote('metaAds', 'meta_ads', 'Anúncios Meta', ['ads']),
  remote('metaInsights', 'meta_insights', 'Métricas Meta', ['ads']),
  remote('metaAnalyses', 'meta_analyses', 'Análises Meta', ['ads']),
  remote('metaReach', 'meta_reach', 'Alcance Meta', ['ads']),

  remote('clinicMembers', 'clinic_members', 'Equipe', []),
  remote('workspacePreferences', 'workspace_preferences', 'Preferências', [], { orderBy:'user_id' }),
]

const FEATURE_TITLES = {
  plans:'Procedimentos',
  sales:'Cirurgias',
  consultations:'Consultas',
  calendar:'Agenda',
  products:'Produtos e estoque',
  finance:'Financeiro',
  cashflow:'Fluxo de caixa',
  dre:'DRE',
  balance:'Balanço patrimonial',
  goals:'Metas',
  recurrences:'Recorrências',
  'ledger-check':'Conferência do razão',
  'chart-of-accounts':'Plano de contas',
  'bank-reconciliation':'Conciliação bancária',
  'financial-import':'Importação financeira',
  patients:'Pacientes',
  funnel:'Funil',
  'crm-painel':'Painel CRM',
  'meu-dia':'Meu dia',
  tarefas:'Tarefas',
  inbox:'WhatsApp',
  ads:'Meta Ads',
  'clinical-records':'Atendimento clínico',
}

const FIELD_LABELS = {
  id:'ID', user_id:'ID da clínica', clinic_id:'ID da clínica', patient_id:'ID do paciente',
  opportunity_id:'ID da oportunidade', product_id:'ID do produto', procedure_id:'ID do procedimento',
  financial_entry_id:'ID do título', financial_installment_id:'ID da parcela', financial_account_id:'ID da conta',
  whatsapp_number_id:'ID do número WhatsApp', full_name:'Nome completo', name:'Nome', title:'Título',
  description:'Descrição', body:'Conteúdo', notes:'Observações', clinical_notes:'Notas clínicas',
  date:'Data', created_at:'Criado em', updated_at:'Atualizado em', archived_at:'Arquivado em',
  due_date:'Vencimento', competence_date:'Competência', payment_date:'Data de pagamento',
  settlement_date:'Data de liquidação', start_date:'Data de início', end_date:'Data final',
  date_of_birth:'Data de nascimento', phone:'Telefone', email:'E-mail', status:'Status', active:'Ativo',
  value:'Valor', amount:'Valor', total_amount:'Valor total', paid_amount:'Valor pago', total_value:'Valor total',
  payment_method:'Forma de pagamento', category:'Categoria', source:'Origem', provider:'Provedor',
  created_by:'Criado por', assigned_user_id:'Responsável', responsible_user_id:'Responsável',
}

const BLOCKED_FIELD = /(^|_)(access_token|refresh_token|api_token|webhook_secret|verify_token|app_secret|client_secret|password|credential|credentials|private_key|encryption_key|encrypted_secret|instance_url)$/i
const BINARY_FIELD = /(^|_)(logo_?data_?url|data_?url|file_?blob|binary_?data)$/i

function local(key, title, features, dateFields = []) {
  return { key, title, features, dateFields, kind:'local' }
}

function remote(key, table, title, features, options = {}) {
  return { key, table, title, features, dateFields:DEFAULT_REMOTE_DATE_FIELDS, kind:'remote', ...options }
}

export function canExportFeature(featureId) {
  return Boolean(FEATURE_TITLES[featureId])
}

export async function exportFeatureWorkbook({ featureId, data = {}, clinicName = '', database = null, generatedAt = new Date().toISOString(), period:periodValue = {} }) {
  if (!canExportFeature(featureId)) throw new Error('Esta funcionalidade ainda não possui exportação em Excel.')
  const period = resolveExportPeriod(periodValue, generatedAt)
  const localSheets = buildLocalSheets(data, featureId, period)
  const remoteDefinitions = REMOTE_SOURCES.filter(source => source.features.includes(featureId))
  const { sheets:remoteSheets, warnings } = await loadRemoteSheets(remoteDefinitions, database, period)
  const sheets = deduplicateSheets([...localSheets, ...remoteSheets])
  const workbook = createPlatformWorkbook({
    title:FEATURE_TITLES[featureId],
    clinicName,
    generatedAt,
    period,
    sheets,
    warnings,
  })
  const filename = buildFilename(clinicName, FEATURE_TITLES[featureId], generatedAt, period)
  XLSXStyle.writeFile(workbook, filename)
  return { filename, warnings, sheetCount:sheets.length, period }
}

export async function exportAllPlatformWorkbook({ data = {}, profile = {}, clinicName = '', database = null, generatedAt = new Date().toISOString(), period:periodValue = {} }) {
  const effectiveClinicName = profile?.clinic?.tradeName || profile?.clinic?.legalName || clinicName
  const period = resolveExportPeriod(periodValue, generatedAt)
  const localSheets = buildLocalSheets(data, '', period)
  const profileSheets = buildProfileSheets(profile)
  const { sheets:remoteSheets, warnings } = await loadRemoteSheets(REMOTE_SOURCES, database, period)
  const sheets = deduplicateSheets([...profileSheets, ...localSheets, ...remoteSheets])
  const workbook = createPlatformWorkbook({
    title:'Exportação completa da plataforma',
    clinicName:effectiveClinicName,
    generatedAt,
    period,
    sheets,
    warnings,
  })
  const filename = buildFilename(effectiveClinicName, 'Dados completos', generatedAt, period)
  XLSXStyle.writeFile(workbook, filename)
  return { filename, warnings, sheetCount:sheets.length, period }
}

export function buildLocalSheets(data = {}, featureId = '', periodValue = {}) {
  const period = resolveExportPeriod(periodValue)
  const definitions = featureId ? LOCAL_SOURCES.filter(source => source.features.includes(featureId)) : LOCAL_SOURCES
  const sheets = definitions.map(source => ({
    title:source.title,
    rows:sanitizeRows(filterRowsByPeriod(data[source.key] || [], period, source.dateFields)),
  }))

  if (!featureId || ['finance', 'dre', 'balance'].includes(featureId)) {
    const indicatorRows = Object.entries(data.indicatorInputs || {}).map(([field, value]) => ({ field, value }))
    const periodRows = Object.entries(data.indicatorInputsByPeriod || {}).map(([period, values]) => ({ period, values }))
    sheets.push({ title:'Indicadores manuais', rows:sanitizeRows(indicatorRows) })
    sheets.push({ title:'Indicadores por período', rows:sanitizeRows(filterRowsByPeriod(periodRows, period, ['period'])) })
  }

  return sheets
}

export async function loadRemoteSheets(definitions, database = null, periodValue = {}) {
  const period = resolveExportPeriod(periodValue)
  if (!database) return { sheets:[], warnings:['A conexão com o banco não está configurada; somente os dados já carregados na tela foram exportados.'] }
  const results = await mapWithConcurrency(definitions, 4, async source => {
    try {
      const rows = await fetchAllRows(database, source)
      return { sheet:{ title:source.title, rows:sanitizeRows(filterRowsByPeriod(rows, period, source.dateFields)) }, warning:'' }
    } catch (error) {
      return {
        sheet:{ title:source.title, rows:[] },
        warning:`${source.title}: ${friendlyQueryError(error)}`,
      }
    }
  })
  return {
    sheets:results.map(result => result.sheet),
    warnings:results.map(result => result.warning).filter(Boolean),
  }
}

export async function fetchAllRows(database, source) {
  const run = async select => {
    const rows = []
    for (let start = 0; ; start += PAGE_SIZE) {
      let query = database.from(source.table).select(select).order(source.orderBy || 'id', { ascending:true }).range(start, start + PAGE_SIZE - 1)
      const result = await query
      if (result.error) throw result.error
      const page = result.data || []
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
    }
    return rows
  }

  try {
    return await run(source.select || '*')
  } catch (error) {
    if (!source.fallbackSelect) throw error
    return run(source.fallbackSelect)
  }
}

export function sanitizeRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => sanitizeObject(row))
}

export function sanitizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (BLOCKED_FIELD.test(key)) return []
    if (BINARY_FIELD.test(key)) return [[key, item ? '[arquivo binário não incluído na planilha]' : '']]
    if (item && typeof item === 'object' && !Array.isArray(item)) return [[key, sanitizeObject(item)]]
    if (Array.isArray(item)) return [[key, item.map(entry => entry && typeof entry === 'object' ? sanitizeObject(entry) : entry)]]
    return [[key, item]]
  }))
}

export function createPlatformWorkbook({ title, clinicName = '', generatedAt = new Date().toISOString(), period:periodValue = {}, sheets = [], warnings = [] }) {
  const period = resolveExportPeriod(periodValue, generatedAt)
  const workbook = XLSXStyle.utils.book_new()
  const normalizedSheets = expandLargeSheets(sheets)
  XLSXStyle.utils.book_append_sheet(workbook, buildOverviewSheet({ title, clinicName, generatedAt, period, sheets:normalizedSheets, warnings }), 'Visão Geral')

  const usedNames = new Set(['Visão Geral'])
  normalizedSheets.forEach(sheet => {
    const sheetName = uniqueSheetName(sheet.title, usedNames)
    usedNames.add(sheetName)
    XLSXStyle.utils.book_append_sheet(workbook, buildDataSheet(sheet, { clinicName, generatedAt, period }), sheetName)
  })
  return workbook
}

function buildProfileSheets(profile = {}) {
  const doctor = sanitizeObject(profile.doctor || {})
  const clinic = sanitizeObject(profile.clinic || {})
  return [
    { title:'Perfil profissional', rows:Object.keys(doctor).length ? [doctor] : [] },
    { title:'Dados da clínica', rows:Object.keys(clinic).length ? [clinic] : [] },
  ]
}

function buildOverviewSheet({ title, clinicName, generatedAt, period, sheets, warnings }) {
  const rows = [
    [`SURGIMETRICS — ${clinicName || 'Clínica não identificada'}`],
    [title],
    [`Gerado em ${formatTimestamp(generatedAt)} · Fuso horário: ${EXPORT_TIME_ZONE}`],
    [`Período exportado: ${period.label}`],
    ['Arquivo gerado localmente no navegador. Proteja-o, pois pode conter dados pessoais, financeiros e clínicos.'],
    [],
    ['Aba', 'Registros'],
    ...sheets.map(sheet => [sheet.title, sheet.rows.length]),
    [],
    ['Avisos da exportação'],
    ...(warnings.length ? warnings.map(warning => [warning]) : [['Nenhuma falha de carregamento identificada.']]),
  ]
  const ws = XLSXStyle.utils.aoa_to_sheet(rows)
  styleMergedRow(ws, 0, STYLES.title, 2)
  styleMergedRow(ws, 1, STYLES.section, 2)
  styleMergedRow(ws, 2, STYLES.subtitle, 2)
  styleMergedRow(ws, 3, STYLES.subtitle, 2)
  styleMergedRow(ws, 4, STYLES.warning, 2)
  styleRow(ws, 6, STYLES.header, 2)
  sheets.forEach((_sheet, index) => {
    setStyle(ws, index + 7, 0, index % 2 ? STYLES.alternate : STYLES.text)
    setStyle(ws, index + 7, 1, STYLES.integer)
  })
  const warningHeader = 8 + sheets.length
  styleMergedRow(ws, warningHeader, STYLES.header, 2)
  for (let row = warningHeader + 1; row < rows.length; row += 1) styleMergedRow(ws, row, warnings.length ? STYLES.warning : STYLES.success, 2)
  ws['!cols'] = [{ wch:48 }, { wch:18 }]
  ws['!rows'] = [{ hpt:30 }, { hpt:24 }, { hpt:20 }, { hpt:20 }, { hpt:34 }]
  return ws
}

function buildDataSheet(sheet, metadata) {
  const rows = sheet.rows || []
  const columns = collectColumns(rows)
  const width = Math.max(3, columns.length)
  const aoa = [
    [`SURGIMETRICS — ${metadata.clinicName || 'Clínica não identificada'} — ${sheet.title}`],
    [`Gerado em ${formatTimestamp(metadata.generatedAt)} · Período: ${metadata.period.label} · ${rows.length.toLocaleString('pt-BR')} registro(s)`],
    [],
    columns.length ? columns.map(column => labelForField(column)) : ['Sem registros', '', ''],
    ...rows.map(row => columns.map(column => normalizeCellValue(row[column], column))),
  ]
  const ws = XLSXStyle.utils.aoa_to_sheet(aoa)
  styleMergedRow(ws, 0, STYLES.title, width)
  styleMergedRow(ws, 1, STYLES.subtitle, width)
  if (columns.length) styleRow(ws, 3, STYLES.header, width)
  else styleMergedRow(ws, 3, STYLES.header, width)
  rows.forEach((row, rowIndex) => {
    columns.forEach((column, columnIndex) => {
      const value = row[column]
      const style = inferCellStyle(column, value, rowIndex)
      setStyle(ws, rowIndex + 4, columnIndex, style)
    })
  })
  const dataColumns = columns.length ? columns.map(column => ({ wch:columnWidth(column, rows) })) : [{ wch:42 }]
  ws['!cols'] = [...dataColumns, ...Array.from({ length:width - dataColumns.length }, () => ({ wch:24 }))]
  ws['!rows'] = [{ hpt:30 }, { hpt:20 }, undefined, { hpt:32 }]
  if (columns.length) ws['!autofilter'] = { ref:`A4:${XLSXStyle.utils.encode_col(columns.length - 1)}${Math.max(4, rows.length + 4)}` }
  return ws
}

function collectColumns(rows) {
  const seen = new Set()
  const columns = []
  rows.forEach(row => Object.keys(row || {}).forEach(key => {
    if (!seen.has(key) && !BLOCKED_FIELD.test(key)) {
      seen.add(key)
      columns.push(key)
    }
  }))
  return columns
}

function normalizeCellValue(value, key) {
  if (value == null) return ''
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number') return Number.isFinite(value) ? value : ''
  if (typeof value === 'object') return truncateCell(JSON.stringify(value))
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatCivilDate(text)
  if (/(_at|timestamp|recorded_at)$/i.test(key) && !Number.isNaN(Date.parse(text))) return formatTimestamp(text)
  return truncateCell(text)
}

function inferCellStyle(key, value, rowIndex) {
  if (typeof value === 'number') {
    if (/(amount|value|price|cost|revenue|balance|fee|interest|discount|total)/i.test(key)) return STYLES.currency
    return Number.isInteger(value) ? STYLES.integer : STYLES.number
  }
  return rowIndex % 2 ? STYLES.alternate : STYLES.text
}

function labelForField(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, char => char.toUpperCase())
}

function columnWidth(key, rows) {
  const labelLength = labelForField(key).length
  const valueLength = rows.slice(0, 100).reduce((max, row) => Math.max(max, String(normalizeCellValue(row[key], key)).length), 0)
  return Math.max(12, Math.min(42, Math.max(labelLength + 2, valueLength + 2)))
}

function expandLargeSheets(sheets) {
  return sheets.flatMap(sheet => {
    if ((sheet.rows || []).length <= MAX_ROWS_PER_SHEET) return [sheet]
    const chunks = []
    for (let start = 0; start < sheet.rows.length; start += MAX_ROWS_PER_SHEET) {
      chunks.push({ title:`${sheet.title} ${Math.floor(start / MAX_ROWS_PER_SHEET) + 1}`, rows:sheet.rows.slice(start, start + MAX_ROWS_PER_SHEET) })
    }
    return chunks
  })
}

function deduplicateSheets(sheets) {
  const byTitle = new Map()
  sheets.forEach(sheet => {
    const current = byTitle.get(sheet.title)
    if (!current) byTitle.set(sheet.title, { ...sheet, rows:[...(sheet.rows || [])] })
    else current.rows.push(...(sheet.rows || []))
  })
  return Array.from(byTitle.values())
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length:Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function friendlyQueryError(error) {
  if (!error) return 'não foi possível carregar os dados.'
  if (error.code === '42P01' || /does not exist|schema cache/i.test(error.message || '')) return 'funcionalidade ainda não disponível neste banco.'
  if (/permission|not allowed|forbidden|row-level security/i.test(error.message || '')) return 'sem permissão para consultar estes dados.'
  return error.message || 'não foi possível carregar os dados.'
}

function formatCivilDate(value) {
  const [year, month, day] = String(value).split('-')
  return `${day}/${month}/${year}`
}

function formatTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value || '')
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone:EXPORT_TIME_ZONE,
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
  }).format(date)
}

function buildFilename(clinicName, title, generatedAt, period = {}) {
  const date = new Date(generatedAt)
  const stamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone:EXPORT_TIME_ZONE,
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit',
  }).format(date).replace(' ', '_').replace(':', '-')
  const periodSuffix = period.filenameSuffix ? `_${safeFilename(period.filenameSuffix)}` : ''
  return `${safeFilename(clinicName || 'Clinica')}_${safeFilename(title)}${periodSuffix}_${stamp}.xlsx`
}

function truncateCell(value) {
  if (value.length <= MAX_CELL_LENGTH) return value
  return `${value.slice(0, MAX_CELL_LENGTH - 36)}… [conteúdo truncado pelo limite do Excel]`
}

function styleMergedRow(ws, row, style, width) {
  styleRow(ws, row, style, Math.max(1, width))
  if (width > 1) merge(ws, row, 0, row, width - 1)
}

function styleRow(ws, row, style, width) {
  for (let column = 0; column < width; column += 1) setStyle(ws, row, column, style)
}

function setStyle(ws, row, column, style) {
  const ref = XLSXStyle.utils.encode_cell({ r:row, c:column })
  if (!ws[ref]) ws[ref] = { t:'s', v:'' }
  ws[ref].s = style
}

function merge(ws, startRow, startColumn, endRow, endColumn) {
  ws['!merges'] = ws['!merges'] || []
  ws['!merges'].push({ s:{ r:startRow, c:startColumn }, e:{ r:endRow, c:endColumn } })
}

function uniqueSheetName(value, usedNames) {
  const base = safeSheetName(value)
  if (!usedNames.has(base)) return base
  let index = 2
  let candidate = safeSheetName(`${base.slice(0, 27)} ${index}`)
  while (usedNames.has(candidate)) {
    index += 1
    candidate = safeSheetName(`${base.slice(0, 27)} ${index}`)
  }
  return candidate
}

function safeSheetName(value) {
  return String(value || 'Dados').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Dados'
}

function safeFilename(value) {
  return String(value || 'Exportacao').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
}
