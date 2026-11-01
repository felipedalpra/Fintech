import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

function loadEnv(path) {
  const values = {}
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    values[key] = value.replace(/\\n/g, '\n')
  }
  return values
}

function filesUnder(path) {
  return readdirSync(path).flatMap(name => {
    const target = join(path, name)
    return statSync(target).isDirectory() ? filesUnder(target) : [target]
  })
}

function literalCalls(pattern) {
  const found = new Map()
  for (const base of ['src', 'api']) {
    for (const file of filesUnder(join(root, base)).filter(item => /\.(js|jsx)$/.test(item))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(pattern)) {
        const places = found.get(match[1]) || []
        places.push(relative(root, file))
        found.set(match[1], places)
      }
    }
  }
  return found
}

function fail(message) {
  console.error(`FALHA: ${message}`)
  process.exitCode = 1
}

const env = { ...loadEnv(join(root, '.env')), ...process.env }
const supabaseUrl = env.VITE_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) throw new Error('Defina VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY. Nenhum segredo é exibido por este script.')

const headers = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}` }
const schemaResponse = await fetch(`${supabaseUrl}/rest/v1/`, { headers })
if (!schemaResponse.ok) throw new Error(`OpenAPI do Supabase indisponível (HTTP ${schemaResponse.status}).`)
const schema = await schemaResponse.json()
const paths = new Set(Object.keys(schema.paths || {}))
const tables = literalCalls(/\.from\(\s*['"]([^'"]+)['"]\s*\)/g)
for (const name of [...tables.keys()]) {
  // Exclui Buffer.from(), storage.from() e o armazenamento legado opcional, que o próprio
  // financeStore detecta por ausência estrutural antes de usar.
  if (!/^[a-z][a-z0-9_]*$/.test(name) || name === 'user_finance_data') tables.delete(name)
}
const rpcs = literalCalls(/\.rpc\(\s*['"]([^'"]+)['"]\s*[,)]/g)
const missingTables = [...tables].filter(([name]) => !paths.has(`/${name}`))
const missingRpcs = [...rpcs].filter(([name]) => !paths.has(`/rpc/${name}`))

console.log(`Contrato: ${tables.size} relações e ${rpcs.size} RPCs literais usados pelo código.`)
if (missingTables.length) fail(`relações ausentes: ${missingTables.map(([name]) => name).join(', ')}`)
if (missingRpcs.length) fail(`RPCs ausentes: ${missingRpcs.map(([name]) => name).join(', ')}`)

async function allRows(table, select, filters = '') {
  const rows = []
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}${filters}`, {
      headers:{ ...headers, Range:`${offset}-${offset + 999}` },
    })
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`)
    const page = await response.json()
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

// Invariantes canônicos: toda origem financeira ativa tem título; nenhum título aponta para uma
// origem inexistente; todo título positivo tem parcela e os valores agregados batem.
const sourceTables = new Map([
  ['surgery', 'surgeries'],
  ['consultation', 'consultations'],
  ['product_sale', 'product_sales'],
  ['product_purchase', 'product_purchases'],
  ['extra_revenue', 'extra_revenues'],
  ['expense', 'expenses'],
])
const [entries, installments, ...sourceRows] = await Promise.all([
  allRows('financial_entries', 'id,source_type,source_id,total_amount', '&archived_at=is.null'),
  allRows('financial_installments', 'financial_entry_id,amount', '&archived_at=is.null'),
  ...[...sourceTables.values()].map(table => allRows(table, 'id', '&archived_at=is.null')),
])
const sourceIds = new Map([...sourceTables.keys()].map((type, index) => [type, new Set(sourceRows[index].map(row => row.id))]))
const entryKeys = new Set(entries.map(row => `${row.source_type}:${row.source_id}`))
const missingProjection = [...sourceIds].flatMap(([type, ids]) => [...ids].filter(id => !entryKeys.has(`${type}:${id}`)).map(id => `${type}:${id}`))
const orphanEntries = entries.filter(row => sourceIds.has(row.source_type) && !sourceIds.get(row.source_type).has(row.source_id))
const installmentTotals = new Map()
for (const row of installments) installmentTotals.set(row.financial_entry_id, (installmentTotals.get(row.financial_entry_id) || 0) + Number(row.amount || 0))
const entriesWithoutInstallment = entries.filter(row => Number(row.total_amount || 0) > 0 && !installmentTotals.has(row.id))
const amountMismatch = entries.filter(row => installmentTotals.has(row.id) && Math.abs(Number(row.total_amount || 0) - installmentTotals.get(row.id)) > 0.009)

if (missingProjection.length) fail(`${missingProjection.length} origem(ns) sem projeção no razão.`)
if (orphanEntries.length) fail(`${orphanEntries.length} título(s) apontando para origem inexistente.`)
if (entriesWithoutInstallment.length) fail(`${entriesWithoutInstallment.length} título(s) positivo(s) sem parcela.`)
if (amountMismatch.length) fail(`${amountMismatch.length} título(s) com soma de parcelas divergente.`)

const [importBatches, importLines, bankImports, bankLines] = await Promise.all([
  allRows('financial_import_batches', 'id,line_count,status', '&archived_at=is.null'),
  allRows('financial_import_lines', 'batch_id,review_status', '&archived_at=is.null'),
  allRows('bank_statement_imports', 'id,line_count,status', '&archived_at=is.null'),
  allRows('bank_statement_lines', 'import_id,review_status,reviewed_at', '&archived_at=is.null'),
])
function countBy(rows, key) {
  return rows.reduce((map, row) => map.set(row[key], (map.get(row[key]) || 0) + 1), new Map())
}
for (const [label, batches, lines, key] of [
  ['importação financeira', importBatches, importLines, 'batch_id'],
  ['extrato bancário', bankImports, bankLines, 'import_id'],
]) {
  const counts = countBy(lines, key)
  const incomplete = batches.filter(batch => Number(batch.line_count || 0) !== Number(counts.get(batch.id) || 0))
  if (incomplete.length) fail(`${incomplete.length} lote(s) de ${label} com contagem de linhas divergente.`)
}

const staleClaims = bankLines.filter(line => line.review_status === 'processing'
  && line.reviewed_at
  && Date.now() - new Date(line.reviewed_at).getTime() > 60 * 60 * 1000)
if (staleClaims.length) fail(`${staleClaims.length} linha(s) bancária(s) reservada(s) há mais de uma hora; revise/recupere a reserva.`)

if (!process.exitCode) console.log(`OK: contrato de schema e invariantes de ${entries.length} títulos, ${installments.length} parcelas e ${bankLines.length + importLines.length} linhas importadas.`)
