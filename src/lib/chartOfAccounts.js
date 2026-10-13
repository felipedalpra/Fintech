import { uid } from '../utils.js'

export const ACCOUNT_NATURES = [
  { value:'asset', label:'Ativo' },
  { value:'liability', label:'Passivo' },
  { value:'equity', label:'Patrimônio líquido' },
  { value:'revenue', label:'Receita' },
  { value:'revenue_deduction', label:'Dedução da receita' },
  { value:'direct_cost', label:'Custo direto / CMV' },
  { value:'operating_expense', label:'Despesa operacional' },
  { value:'depreciation', label:'Depreciação e amortização' },
  { value:'financial_revenue', label:'Receita financeira' },
  { value:'financial_expense', label:'Despesa financeira' },
  { value:'income_tax', label:'Tributo sobre o lucro' },
  { value:'unclassified', label:'A classificar' },
]

export const DRE_SECTIONS = [
  { value:'balance', label:'Balanço patrimonial' },
  { value:'gross_revenue', label:'Receita bruta' },
  { value:'revenue_deductions', label:'Deduções da receita' },
  { value:'direct_costs', label:'Custos diretos e CMV' },
  { value:'personnel', label:'Despesas com pessoal' },
  { value:'administrative', label:'Despesas administrativas' },
  { value:'operations', label:'Despesas da operação' },
  { value:'marketing', label:'Despesas de marketing' },
  { value:'depreciation', label:'Depreciação e amortização' },
  { value:'financial_result', label:'Resultado financeiro' },
  { value:'income_taxes', label:'Tributos sobre o lucro' },
  { value:'unclassified', label:'A classificar' },
]

const group = (code, name, nature, dreSection, children = [], extra = {}) => ({ code, name, nature, dreSection, nodeType:'group', children, ...extra })
const account = (code, name, nature, dreSection, extra = {}) => ({ code, name, nature, dreSection, nodeType:'account', ...extra })

// Modelo inicial por clínica. Grupos organizam; somente contas finais recebem lançamentos.
export const DEFAULT_CHART_TREE = [
  group('1', 'Ativo', 'asset', 'balance', [
    group('1.01', 'Disponibilidades', 'asset', 'balance', [
      account('1.01.01', 'Caixa', 'asset', 'balance', { systemKey:'asset_cash' }),
      account('1.01.02', 'Bancos', 'asset', 'balance', { systemKey:'asset_bank' }),
      account('1.01.03', 'Aplicações financeiras', 'asset', 'balance'),
    ]),
    group('1.02', 'Contas a receber', 'asset', 'balance', [
      account('1.02.01', 'Procedimentos a receber', 'asset', 'balance'),
      account('1.02.02', 'Consultas a receber', 'asset', 'balance'),
      account('1.02.03', 'Produtos a receber', 'asset', 'balance'),
      account('1.02.04', 'Outras receitas a receber', 'asset', 'balance'),
    ]),
    group('1.03', 'Estoques', 'asset', 'balance', [
      account('1.03.01', 'Malhas, meias e sutiãs', 'asset', 'balance', { systemKey:'asset_inventory_products' }),
      account('1.03.02', 'Materiais e produtos para revenda', 'asset', 'balance'),
    ]),
    group('1.04', 'Imobilizado', 'asset', 'balance', [
      account('1.04.01', 'Máquinas e equipamentos clínicos', 'asset', 'balance'),
      account('1.04.02', 'Equipamentos de informática', 'asset', 'balance'),
      account('1.04.03', 'Móveis e utensílios', 'asset', 'balance'),
      account('1.04.04', 'Benfeitorias e reforma da clínica', 'asset', 'balance'),
      account('1.04.90', 'Depreciação acumulada', 'asset', 'balance'),
    ]),
  ]),
  group('2', 'Passivo', 'liability', 'balance', [
    group('2.01', 'Fornecedores e prestadores', 'liability', 'balance', [
      account('2.01.01', 'Fornecedores de materiais', 'liability', 'balance'),
      account('2.01.02', 'Hospitais a pagar', 'liability', 'balance'),
      account('2.01.03', 'Anestesistas e equipe médica a pagar', 'liability', 'balance'),
      account('2.01.04', 'Prestadores de serviços a pagar', 'liability', 'balance'),
    ]),
    group('2.02', 'Obrigações trabalhistas', 'liability', 'balance', [
      account('2.02.01', 'Salários a pagar', 'liability', 'balance'),
      account('2.02.02', 'Pró-labore a pagar', 'liability', 'balance'),
      account('2.02.03', 'INSS a recolher', 'liability', 'balance'),
      account('2.02.04', 'FGTS a recolher', 'liability', 'balance'),
      account('2.02.05', 'IRRF a recolher', 'liability', 'balance'),
    ]),
    group('2.03', 'Obrigações tributárias', 'liability', 'balance', [
      account('2.03.01', 'DAS a recolher', 'liability', 'balance'),
      account('2.03.02', 'ISS a recolher', 'liability', 'balance'),
      account('2.03.03', 'PIS a recolher', 'liability', 'balance'),
      account('2.03.04', 'COFINS a recolher', 'liability', 'balance'),
      account('2.03.05', 'IRPJ a recolher', 'liability', 'balance'),
      account('2.03.06', 'Adicional de IRPJ a recolher', 'liability', 'balance'),
      account('2.03.07', 'CSLL a recolher', 'liability', 'balance'),
    ]),
    group('2.04', 'Empréstimos e financiamentos', 'liability', 'balance', [
      account('2.04.01', 'Empréstimos bancários', 'liability', 'balance'),
      account('2.04.02', 'Financiamentos de equipamentos', 'liability', 'balance'),
    ]),
  ]),
  group('3', 'Patrimônio líquido', 'equity', 'balance', [
    account('3.01', 'Capital social', 'equity', 'balance'),
    account('3.02', 'Lucros ou prejuízos acumulados', 'equity', 'balance'),
    account('3.03', 'Resultado do exercício', 'equity', 'balance'),
    account('3.04', 'Distribuição de lucros', 'equity', 'balance'),
  ]),
  group('4', 'Receita bruta', 'revenue', 'gross_revenue', [
    group('4.01', 'Cirurgias', 'revenue', 'gross_revenue', [
      account('4.01.01', 'Cirurgia corporal', 'revenue', 'gross_revenue'),
      account('4.01.02', 'Cirurgia de mama', 'revenue', 'gross_revenue'),
      account('4.01.03', 'Cirurgia facial', 'revenue', 'gross_revenue'),
      account('4.01.04', 'Cirurgia combinada', 'revenue', 'gross_revenue'),
      account('4.01.99', 'Outras cirurgias', 'revenue', 'gross_revenue', { systemKey:'revenue_surgery_default' }),
    ]),
    group('4.02', 'Injetáveis e estética', 'revenue', 'gross_revenue', [
      account('4.02.01', 'Preenchimento', 'revenue', 'gross_revenue'),
      account('4.02.02', 'Toxina botulínica', 'revenue', 'gross_revenue'),
      account('4.02.03', 'Outros procedimentos injetáveis', 'revenue', 'gross_revenue'),
    ]),
    group('4.03', 'Consultas', 'revenue', 'gross_revenue', [
      account('4.03.01', 'Consulta de cirurgia plástica', 'revenue', 'gross_revenue', { systemKey:'revenue_consultation' }),
      account('4.03.02', 'Consulta de retorno remunerada', 'revenue', 'gross_revenue'),
      account('4.03.99', 'Outras consultas', 'revenue', 'gross_revenue'),
    ]),
    group('4.04', 'Procedimentos', 'revenue', 'gross_revenue', [
      account('4.04.01', 'Procedimentos estéticos', 'revenue', 'gross_revenue', { systemKey:'revenue_procedure' }),
      account('4.04.02', 'Procedimentos ambulatoriais', 'revenue', 'gross_revenue'),
      account('4.04.99', 'Outros procedimentos', 'revenue', 'gross_revenue'),
    ]),
    group('4.05', 'Especialidades', 'revenue', 'gross_revenue', [
      account('4.05.01', 'Ginecologia', 'revenue', 'gross_revenue'),
      account('4.05.02', 'Endocrinologia', 'revenue', 'gross_revenue'),
      account('4.05.03', 'Nutrição', 'revenue', 'gross_revenue'),
      account('4.05.04', 'Dermatologia', 'revenue', 'gross_revenue'),
      account('4.05.05', 'Fisioterapia', 'revenue', 'gross_revenue'),
      account('4.05.99', 'Outras especialidades', 'revenue', 'gross_revenue', { systemKey:'revenue_specialty' }),
    ]),
    group('4.06', 'Venda de produtos', 'revenue', 'gross_revenue', [
      account('4.06.01', 'Malhas, meias e sutiãs', 'revenue', 'gross_revenue', { systemKey:'revenue_product' }),
      account('4.06.02', 'Cosméticos e produtos', 'revenue', 'gross_revenue'),
      account('4.06.99', 'Outros produtos', 'revenue', 'gross_revenue'),
    ]),
    group('4.07', 'Outras receitas operacionais', 'revenue', 'gross_revenue', [
      account('4.07.01', 'Contratos e parcerias', 'revenue', 'gross_revenue'),
      account('4.07.02', 'Aluguel de equipamentos', 'revenue', 'gross_revenue'),
      account('4.07.99', 'Outras receitas operacionais', 'revenue', 'gross_revenue', { systemKey:'revenue_other' }),
    ]),
  ]),
  group('5', 'Deduções da receita', 'revenue_deduction', 'revenue_deductions', [
    group('5.01', 'Tributos sobre faturamento', 'revenue_deduction', 'revenue_deductions', [
      account('5.01.01', 'DAS — Simples Nacional', 'revenue_deduction', 'revenue_deductions'),
      account('5.01.02', 'ISS', 'revenue_deduction', 'revenue_deductions', { systemKey:'deduction_invoice_tax' }),
      account('5.01.03', 'PIS', 'revenue_deduction', 'revenue_deductions'),
      account('5.01.04', 'COFINS', 'revenue_deduction', 'revenue_deductions'),
    ]),
    group('5.02', 'Deduções comerciais', 'revenue_deduction', 'revenue_deductions', [
      account('5.02.01', 'Descontos concedidos', 'revenue_deduction', 'revenue_deductions'),
      account('5.02.02', 'Cancelamentos e estornos', 'revenue_deduction', 'revenue_deductions'),
      account('5.02.03', 'Devoluções e reembolsos a clientes', 'revenue_deduction', 'revenue_deductions'),
      account('5.02.04', 'Chargebacks', 'revenue_deduction', 'revenue_deductions'),
    ]),
  ]),
  group('6', 'Custos diretos e CMV', 'direct_cost', 'direct_costs', [
    group('6.01', 'Custos diretos de cirurgias', 'direct_cost', 'direct_costs', [
      account('6.01.01', 'Hospital e centro cirúrgico', 'direct_cost', 'direct_costs', { systemKey:'cost_surgery_hospital' }),
      account('6.01.02', 'Anestesia', 'direct_cost', 'direct_costs', { systemKey:'cost_surgery_anesthesia' }),
      account('6.01.03', 'Materiais e medicamentos cirúrgicos', 'direct_cost', 'direct_costs', { systemKey:'cost_surgery_material' }),
      account('6.01.04', 'Médico auxiliar e equipe cirúrgica', 'direct_cost', 'direct_costs', { systemKey:'cost_surgery_auxiliary' }),
      account('6.01.05', 'Instrumentação e apoio', 'direct_cost', 'direct_costs'),
      account('6.01.99', 'Outros custos de cirurgias', 'direct_cost', 'direct_costs', { systemKey:'cost_surgery_other' }),
    ]),
    group('6.02', 'Custos diretos de consultas', 'direct_cost', 'direct_costs', [
      account('6.02.01', 'Materiais utilizados em consultas', 'direct_cost', 'direct_costs'),
      account('6.02.02', 'Profissionais vinculados às consultas', 'direct_cost', 'direct_costs'),
      account('6.02.99', 'Outros custos de consultas', 'direct_cost', 'direct_costs', { systemKey:'cost_consultation' }),
    ]),
    group('6.03', 'Custos diretos de procedimentos', 'direct_cost', 'direct_costs', [
      account('6.03.01', 'Medicamentos e insumos', 'direct_cost', 'direct_costs'),
      account('6.03.02', 'Materiais descartáveis', 'direct_cost', 'direct_costs'),
      account('6.03.03', 'Profissional auxiliar', 'direct_cost', 'direct_costs'),
      account('6.03.99', 'Outros custos de procedimentos', 'direct_cost', 'direct_costs'),
    ]),
    group('6.04', 'Custos diretos de especialidades', 'direct_cost', 'direct_costs', [
      account('6.04.01', 'Repasse a profissionais', 'direct_cost', 'direct_costs'),
      account('6.04.02', 'Materiais das especialidades', 'direct_cost', 'direct_costs'),
      account('6.04.99', 'Outros custos de especialidades', 'direct_cost', 'direct_costs'),
    ]),
    group('6.05', 'Custo das mercadorias vendidas — CMV', 'direct_cost', 'direct_costs', [
      account('6.05.01', 'CMV — Malhas, meias e sutiãs', 'direct_cost', 'direct_costs', { systemKey:'cost_product_cmv' }),
      account('6.05.02', 'CMV — Cosméticos e produtos', 'direct_cost', 'direct_costs'),
      account('6.05.99', 'CMV — Outros produtos', 'direct_cost', 'direct_costs'),
    ]),
    group('6.06', 'Custos variáveis de venda', 'direct_cost', 'direct_costs', [
      account('6.06.01', 'Comissões', 'direct_cost', 'direct_costs'),
      account('6.06.02', 'Taxas de cartão', 'direct_cost', 'direct_costs'),
      account('6.06.03', 'Taxas de plataformas de pagamento', 'direct_cost', 'direct_costs'),
    ]),
  ]),
  group('7', 'Despesas operacionais', 'operating_expense', 'administrative', [
    group('7.01', 'Pessoal', 'operating_expense', 'personnel', [
      account('7.01.01', 'Salários', 'operating_expense', 'personnel'),
      account('7.01.02', 'Pró-labore', 'operating_expense', 'personnel'),
      account('7.01.03', 'INSS patronal', 'operating_expense', 'personnel'),
      account('7.01.04', 'FGTS', 'operating_expense', 'personnel'),
      account('7.01.05', 'Férias', 'operating_expense', 'personnel'),
      account('7.01.06', '13º salário', 'operating_expense', 'personnel'),
      account('7.01.07', 'Vale-transporte', 'operating_expense', 'personnel'),
      account('7.01.08', 'Vale-alimentação', 'operating_expense', 'personnel'),
      account('7.01.09', 'Plano de saúde', 'operating_expense', 'personnel'),
      account('7.01.10', 'Horas extras', 'operating_expense', 'personnel'),
      account('7.01.11', 'Recrutamento e admissão', 'operating_expense', 'personnel'),
      account('7.01.12', 'Rescisões', 'operating_expense', 'personnel'),
      account('7.01.13', 'Treinamentos e capacitações', 'operating_expense', 'personnel'),
      account('7.01.14', 'Endomarketing', 'operating_expense', 'personnel'),
      account('7.01.99', 'Outras despesas com pessoal', 'operating_expense', 'personnel'),
    ]),
    group('7.02', 'Administrativas', 'operating_expense', 'administrative', [
      account('7.02.01', 'Aluguel', 'operating_expense', 'administrative'),
      account('7.02.02', 'Condomínio', 'operating_expense', 'administrative'),
      account('7.02.03', 'IPTU', 'operating_expense', 'administrative'),
      account('7.02.04', 'Energia elétrica', 'operating_expense', 'administrative'),
      account('7.02.05', 'Água', 'operating_expense', 'administrative'),
      account('7.02.06', 'Telefone e internet', 'operating_expense', 'administrative'),
      account('7.02.07', 'Sistemas e softwares administrativos', 'operating_expense', 'administrative'),
      account('7.02.08', 'Consultoria', 'operating_expense', 'administrative'),
      account('7.02.09', 'Jurídico', 'operating_expense', 'administrative'),
      account('7.02.10', 'Contabilidade', 'operating_expense', 'administrative'),
      account('7.02.11', 'Seguros', 'operating_expense', 'administrative'),
      account('7.02.12', 'Material de escritório', 'operating_expense', 'administrative'),
      account('7.02.13', 'Entidades de classe e associações', 'operating_expense', 'administrative'),
      account('7.02.14', 'Prestadores de serviços administrativos', 'operating_expense', 'administrative'),
      account('7.02.99', 'Outras despesas administrativas', 'operating_expense', 'administrative', { systemKey:'expense_other' }),
    ]),
    group('7.03', 'Operação da clínica', 'operating_expense', 'operations', [
      account('7.03.01', 'Limpeza', 'operating_expense', 'operations'),
      account('7.03.02', 'Segurança', 'operating_expense', 'operations'),
      account('7.03.03', 'Gestão de resíduos', 'operating_expense', 'operations'),
      account('7.03.04', 'Dedetização', 'operating_expense', 'operations'),
      account('7.03.05', 'Manutenção de extintores', 'operating_expense', 'operations'),
      account('7.03.06', 'Viagens e deslocamentos operacionais', 'operating_expense', 'operations'),
      account('7.03.07', 'Vigilância Sanitária e licenças', 'operating_expense', 'operations'),
      account('7.03.08', 'Manutenção e reparos', 'operating_expense', 'operations'),
      account('7.03.09', 'Material operacional', 'operating_expense', 'operations'),
      account('7.03.10', 'Lavanderia e esterilização', 'operating_expense', 'operations'),
      account('7.03.99', 'Outras despesas operacionais', 'operating_expense', 'operations'),
    ]),
    group('7.04', 'Marketing e vendas', 'operating_expense', 'marketing', [
      account('7.04.01', 'Site, domínio e hospedagem', 'operating_expense', 'marketing'),
      account('7.04.02', 'Agência de marketing', 'operating_expense', 'marketing'),
      account('7.04.03', 'Mídias digitais e ferramentas', 'operating_expense', 'marketing'),
      account('7.04.04', 'Tráfego pago', 'operating_expense', 'marketing'),
      account('7.04.05', 'Fotografia e produção de conteúdo', 'operating_expense', 'marketing'),
      account('7.04.06', 'Relacionamento e brindes', 'operating_expense', 'marketing'),
      account('7.04.07', 'Material gráfico e cartões', 'operating_expense', 'marketing'),
      account('7.04.08', 'Ações de marca e eventos', 'operating_expense', 'marketing'),
      account('7.04.99', 'Outras despesas de marketing', 'operating_expense', 'marketing'),
    ]),
    group('7.05', 'Depreciação e amortização', 'depreciation', 'depreciation', [
      account('7.05.01', 'Depreciação de equipamentos clínicos', 'depreciation', 'depreciation'),
      account('7.05.02', 'Depreciação de informática', 'depreciation', 'depreciation'),
      account('7.05.03', 'Depreciação de móveis e utensílios', 'depreciation', 'depreciation'),
      account('7.05.04', 'Amortização de benfeitorias', 'depreciation', 'depreciation'),
      account('7.05.99', 'Outras depreciações e amortizações', 'depreciation', 'depreciation'),
    ]),
  ]),
  group('8', 'Resultado financeiro', 'unclassified', 'financial_result', [
    group('8.01', 'Receitas financeiras', 'financial_revenue', 'financial_result', [
      account('8.01.01', 'Rendimentos de aplicações', 'financial_revenue', 'financial_result'),
      account('8.01.02', 'Juros recebidos', 'financial_revenue', 'financial_result'),
      account('8.01.03', 'Descontos financeiros obtidos', 'financial_revenue', 'financial_result'),
    ]),
    group('8.02', 'Despesas financeiras', 'financial_expense', 'financial_result', [
      account('8.02.01', 'Juros pagos', 'financial_expense', 'financial_result'),
      account('8.02.02', 'Multas e encargos', 'financial_expense', 'financial_result'),
      account('8.02.03', 'IOF', 'financial_expense', 'financial_result'),
      account('8.02.04', 'Tarifas bancárias', 'financial_expense', 'financial_result'),
      account('8.02.05', 'Juros de empréstimos e financiamentos', 'financial_expense', 'financial_result'),
      account('8.02.06', 'Taxas de antecipação de recebíveis', 'financial_expense', 'financial_result'),
    ]),
  ]),
  group('9', 'Tributos sobre o lucro', 'income_tax', 'income_taxes', [
    account('9.01', 'IRPJ', 'income_tax', 'income_taxes'),
    account('9.02', 'Adicional de IRPJ', 'income_tax', 'income_taxes'),
    account('9.03', 'CSLL', 'income_tax', 'income_taxes'),
  ]),
  group('10', 'Classificação pendente', 'unclassified', 'unclassified', [
    account('10.01', 'Receita a classificar', 'unclassified', 'unclassified', { systemKey:'unclassified_revenue' }),
    account('10.02', 'Pagamento a classificar', 'unclassified', 'unclassified', { systemKey:'unclassified_expense' }),
  ]),
]

export function flattenDefaultChart(userId, idFactory = uid) {
  const rows = []
  function visit(nodes, parentId = null) {
    nodes.forEach((node, index) => {
      const id = idFactory()
      rows.push({
        id,
        user_id:userId,
        parent_id:parentId,
        code:node.code,
        name:node.name,
        node_type:node.nodeType,
        nature:node.nature,
        dre_section:node.dreSection,
        description:node.description || null,
        system_key:node.systemKey || null,
        is_active:true,
        sort_order:(index + 1) * 10,
      })
      if (node.children?.length) visit(node.children, id)
    })
  }
  visit(DEFAULT_CHART_TREE)
  return rows
}

export function normalizeChartAccount(row) {
  return {
    id:row.id,
    parentId:row.parent_id ?? row.parentId ?? null,
    code:String(row.code || ''),
    name:String(row.name || ''),
    nodeType:row.node_type || row.nodeType || 'account',
    nature:row.nature || 'unclassified',
    dreSection:row.dre_section || row.dreSection || 'unclassified',
    description:row.description || '',
    systemKey:row.system_key || row.systemKey || '',
    isActive:row.is_active ?? row.isActive ?? true,
    sortOrder:Number(row.sort_order ?? row.sortOrder ?? 0),
  }
}

export function buildAccountTree(accounts = []) {
  const normalized = accounts.map(normalizeChartAccount)
  const byParent = new Map()
  normalized.forEach(item => {
    const key = item.parentId || '__root__'
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key).push(item)
  })
  const sort = rows => rows.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'pt-BR', { numeric:true }) || a.name.localeCompare(b.name))
  const visit = parentId => sort(byParent.get(parentId || '__root__') || []).map(item => ({ ...item, children:visit(item.id) }))
  return visit(null)
}

export function descendantIds(accounts = [], accountId) {
  const children = new Map()
  accounts.map(normalizeChartAccount).forEach(item => {
    if (!item.parentId) return
    if (!children.has(item.parentId)) children.set(item.parentId, [])
    children.get(item.parentId).push(item.id)
  })
  const result = []
  const queue = [...(children.get(accountId) || [])]
  while (queue.length) {
    const id = queue.shift()
    result.push(id)
    queue.push(...(children.get(id) || []))
  }
  return result
}

export function canMoveAccount(accounts, accountId, nextParentId) {
  if (!accountId) return false
  if (!nextParentId) return true
  if (accountId === nextParentId) return false
  return !descendantIds(accounts, accountId).includes(nextParentId)
}

export function accountPath(accounts = [], accountId) {
  const map = new Map(accounts.map(row => {
    const item = normalizeChartAccount(row)
    return [item.id, item]
  }))
  const path = []
  const seen = new Set()
  let current = map.get(accountId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? map.get(current.parentId) : null
  }
  return path
}

export function postingAccountOptions(accounts = [], direction) {
  const allowed = direction === 'receivable'
    ? new Set(['revenue', 'financial_revenue', 'unclassified'])
    : direction === 'payable'
      ? new Set(['revenue_deduction', 'direct_cost', 'operating_expense', 'depreciation', 'financial_expense', 'income_tax', 'unclassified'])
      : null
  return accounts
    .map(normalizeChartAccount)
    .filter(item => item.nodeType === 'account' && item.isActive && (!allowed || allowed.has(item.nature)))
    .sort((a, b) => a.code.localeCompare(b.code, 'pt-BR', { numeric:true }))
    .map(item => ({ value:item.id, label:`${item.code} · ${accountPath(accounts, item.id).map(node => node.name).join(' › ')}`, account:item }))
}

export function findChartAccount(accounts = [], { id, systemKey, legacyCategory, direction } = {}) {
  const normalized = accounts.map(normalizeChartAccount)
  if (id) {
    const byId = normalized.find(item => item.id === id)
    if (byId) return byId
  }
  if (systemKey) {
    const bySystem = normalized.find(item => item.systemKey === systemKey && item.isActive)
    if (bySystem) return bySystem
  }
  const mappedKey = LEGACY_CATEGORY_SYSTEM_KEYS[String(legacyCategory || '').toLowerCase()]
  if (mappedKey) {
    const byLegacy = normalized.find(item => item.systemKey === mappedKey && item.isActive)
    if (byLegacy) return byLegacy
  }
  const fallbackKey = direction === 'receivable' ? 'unclassified_revenue' : 'unclassified_expense'
  return normalized.find(item => item.systemKey === fallbackKey && item.isActive) || null
}

export function chartAccountFields(accountRow, fallbackCategory = null) {
  const account = accountRow ? normalizeChartAccount(accountRow) : null
  return {
    chart_account_id:account?.id || null,
    category:account?.name || fallbackCategory || null,
    account_nature:account?.nature || null,
    dre_section:account?.dreSection || null,
  }
}

export const LEGACY_CATEGORY_SYSTEM_KEYS = {
  cirurgia:'revenue_surgery_default',
  consulta:'revenue_consultation',
  outras_receitas:'revenue_other',
  venda_produto:'revenue_product',
  hospital:'cost_surgery_hospital',
  anestesia:'cost_surgery_anesthesia',
  custo_cirurgico:'cost_surgery_other',
  custo_consulta:'cost_consultation',
  compra_produto:'asset_inventory_products',
  outros:'expense_other',
}

export function nextSiblingOrder(accounts = [], parentId = null) {
  const siblings = accounts.map(normalizeChartAccount).filter(item => (item.parentId || null) === (parentId || null))
  return Math.max(0, ...siblings.map(item => item.sortOrder)) + 10
}
