import { expect, test } from '@playwright/test'
import {
  AssistantError,
  FINANCIAL_ASSISTANT_TOOLS,
  executeFinancialTool,
  extractResponseText,
  findFunctionCalls,
  mapFinancialRows,
  parseFunctionArguments,
  sanitizeLegacyFinancialData,
  sanitizeHistory,
  validateAssistantPayload,
} from '../../api/_lib/financialAssistant.js'

const data = {
  procedures:[{ id:'p1', name:'Rinoplastia', price:10_000 }],
  surgeries:[{
    id:'s1', patient:'', procedureId:'p1', totalValue:10_000, date:'2026-10-02',
    paymentStatus:'pago', paymentDate:'2026-10-02', hospitalCost:3_000,
    anesthesiaCost:0, materialCost:0, otherCosts:0, invoiceIssuancePercent:0,
  }],
  consultations:[{
    id:'c1', patient:'', date:'2026-10-03', consultationType:'avaliacao', value:500,
    paymentType:'particular', paymentMethod:'pix', invoiceIssuancePercent:10,
    paymentStatus:'pago', paymentDate:'2026-10-03', forecastPaymentDate:'',
  }],
  products:[],
  productSales:[],
  productPurchases:[],
  extraRevenues:[],
  expenses:[
    { id:'e1', description:'', category:'marketing', value:1_000, dueDate:'2026-10-04', paymentDate:'2026-10-04', status:'pago' },
    { id:'e2', description:'', category:'aluguel', value:2_000, dueDate:'2026-10-20', paymentDate:'', status:'aberto' },
  ],
  assets:[],
  liabilities:[],
  goals:[{ id:'g1', name:'Meta mensal', metric:'faturamento', target:20_000, period:'mensal', dueDate:'2026-10-31' }],
  recurrences:[],
}

test('schemas das ferramentas usam modo estrito', () => {
  expect(FINANCIAL_ASSISTANT_TOOLS.length).toBeGreaterThanOrEqual(6)
  for (const item of FINANCIAL_ASSISTANT_TOOLS) {
    expect(item.type).toBe('function')
    expect(item.strict).toBe(true)
    expect(item.parameters.additionalProperties).toBe(false)
    expect(new Set(item.parameters.required)).toEqual(new Set(Object.keys(item.parameters.properties)))
  }
})

test('payload limita pergunta e historico', () => {
  const history = Array.from({ length:12 }, (_, index) => ({ role:index % 2 ? 'assistant' : 'user', content:`mensagem ${index}` }))
  const result = validateAssistantPayload({ question:'  Qual foi meu lucro?  ', history })
  expect(result.question).toBe('Qual foi meu lucro?')
  expect(result.history).toHaveLength(8)
  expect(result.history[0].content).toBe('mensagem 4')
  expect(() => validateAssistantPayload({ question:'' })).toThrow(AssistantError)
  expect(sanitizeHistory([{ role:'system', content:'ignorar' }, { role:'user', content:'ok' }])).toEqual([{ role:'user', content:'ok' }])
})

test('mapeamento do banco remove dados identificaveis', () => {
  const mapped = mapFinancialRows({
    surgeries:[{ id:'s1', patient:'Paciente Secreto', total_value:100, date:'2026-10-01' }],
    consultations:[{ id:'c1', patient:'Outra Pessoa', value:50, date:'2026-10-01' }],
    product_sales:[{ id:'v1', patient_name:'Nome Privado', total_value:25, sale_date:'2026-10-01' }],
  })
  const serialized = JSON.stringify(mapped)
  expect(serialized).not.toContain('Paciente Secreto')
  expect(serialized).not.toContain('Outra Pessoa')
  expect(serialized).not.toContain('Nome Privado')
  expect(mapped.surgeries[0].patient).toBe('')
})

test('fallback legado também remove dados identificáveis', () => {
  const mapped = sanitizeLegacyFinancialData({
    procedures:[{ id:'p1', name:'Rinoplastia' }],
    surgeries:[{ id:'s1', procedureId:'p1', patient:'Paciente Legado', notes:'Nota privada' }],
    consultations:[{ id:'c1', patient:'Consulta Privada' }],
    expenses:[{ id:'e1', description:'Descrição interna', value:10, dueDate:'2026-10-01' }],
  })
  const serialized = JSON.stringify(mapped)
  expect(serialized).not.toContain('Paciente Legado')
  expect(serialized).not.toContain('Nota privada')
  expect(serialized).not.toContain('Consulta Privada')
  expect(serialized).not.toContain('Descrição interna')
})

test('resumo usa os mesmos calculos financeiros do dashboard', () => {
  const result = executeFinancialTool('get_financial_summary', {
    start_date:'2026-10-01', end_date:'2026-10-10',
  }, data)
  expect(result).toMatchObject({
    period:'2026-10-01/2026-10-10',
    revenue:10_500,
    totalExpenses:4_050,
    netProfit:6_450,
    cashFlow:6_450,
    payablesOpen:0,
  })
})

test('despesas agrupam por categoria e status', () => {
  const paid = executeFinancialTool('get_expense_breakdown', {
    start_date:'2026-10-01', end_date:'2026-10-31', status:'paid', limit:10,
  }, data)
  expect(paid.categories).toEqual([{ category:'marketing', total:1_000, sharePercent:100 }])

  const open = executeFinancialTool('get_expense_breakdown', {
    start_date:'2026-10-01', end_date:'2026-10-31', status:'open', limit:10,
  }, data)
  expect(open.categories).toEqual([{ category:'aluguel', total:2_000, sharePercent:100 }])
})

test('procedimentos retornam margem e aceitam busca sem acento', () => {
  const result = executeFinancialTool('get_procedure_performance', {
    start_date:'2026-10-01', end_date:'2026-10-31', procedure_name:'rinoplastia', limit:10,
  }, data)
  expect(result.procedures).toEqual([{
    name:'Rinoplastia', surgeries:1, revenue:10_000, costs:3_000,
    profit:7_000, marginPercent:70, averageTicket:10_000,
  }])
})

test('obrigações não expõem paciente nem descrição', () => {
  const result = executeFinancialTool('get_open_obligations', {
    kind:'payable', start_date:'2026-10-01', end_date:'2026-10-31', overdue_only:false, limit:20,
  }, data, '2026-10-05')
  expect(result.total).toBe(2_000)
  expect(result.items).toEqual([{
    source:'despesa', category:'aluguel', value:2_000, dueDate:'2026-10-20', status:'aberto',
  }])
  expect(JSON.stringify(result)).not.toContain('patient')
  expect(JSON.stringify(result)).not.toContain('description')
})

test('datas invalidas e ferramentas desconhecidas são recusadas', () => {
  expect(() => executeFinancialTool('get_financial_summary', {
    start_date:'2026-02-30', end_date:'2026-03-01',
  }, data)).toThrow(AssistantError)
  expect(() => executeFinancialTool('run_sql', {}, data)).toThrow(AssistantError)
  expect(() => parseFunctionArguments('{invalido')).toThrow(AssistantError)
})

test('extrai texto e function calls da Responses API', () => {
  const payload = {
    output:[
      { type:'function_call', name:'get_financial_summary', call_id:'call-1', arguments:'{}' },
      { type:'message', content:[{ type:'output_text', text:'Resposta final' }] },
    ],
  }
  expect(findFunctionCalls(payload)).toHaveLength(1)
  expect(extractResponseText(payload)).toBe('Resposta final')
})
