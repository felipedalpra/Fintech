import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Contrato: toda coluna que o app grava precisa ser criada por alguma migration
// ---------------------------------------------------------------------------
// Bug em producao (31/10/2026): a importacao do extrato falhava com
// "Could not find the 'movement_fingerprint' column ... in the schema cache"
// (PGRST204). A coluna e criada por `bank_reconciliation_xlsx_review_schema.sql`,
// que nunca tinha sido aplicada naquele banco -- e NADA no repositorio ligava
// "o app grava esta coluna" a "alguma migration cria esta coluna".
//
// Pior: o erro so apareceu depois de tres outros bugs serem corrigidos, porque
// cada um escondia o seguinte. Nenhum dos testes pegou, porque todos mockam o
// banco.
//
// Esta guarda e estatica e roda sem banco. Ela nao garante que a migration FOI
// aplicada (so o banco sabe), mas garante que ela EXISTE -- que e o que faltava.

const supabaseDir = join(process.cwd(), 'supabase')
const storePath = join(process.cwd(), 'src/lib/bankReconciliationStore.js')

// Le as colunas que `toLineRow` monta, direto do codigo: assim a lista nao
// envelhece em silencio quando alguem acrescentar um campo.
function colunasGravadasPeloApp() {
  const fonte = readFileSync(storePath, 'utf8')
  const inicio = fonte.indexOf('function toLineRow(')
  expect(inicio, 'toLineRow não encontrado: o nome mudou?').toBeGreaterThan(-1)
  const corpo = fonte.slice(inicio, fonte.indexOf('\n}', inicio))
  return [...corpo.matchAll(/^\s{4}([a-z_]+):/gm)].map(match => match[1])
}

function sqlDeTodasAsMigrations() {
  return readdirSync(supabaseDir)
    .filter(name => name.endsWith('.sql'))
    .map(name => readFileSync(join(supabaseDir, name), 'utf8'))
    .join('\n')
}

test('toda coluna gravada em bank_statement_lines é criada por uma migration', () => {
  const colunas = colunasGravadasPeloApp()
  expect(colunas.length, 'nenhuma coluna lida de toLineRow').toBeGreaterThan(10)

  const sql = sqlDeTodasAsMigrations()
  const ausentes = colunas.filter(coluna => {
    const naTabela = new RegExp(`^\\s*${coluna}\\s+(uuid|text|date|numeric|integer|jsonb|timestamptz|boolean)`, 'm')
    const adicionada = new RegExp(`add column if not exists ${coluna}\\b`)
    return !naTabela.test(sql) && !adicionada.test(sql)
  })

  expect(
    ausentes,
    `O app grava coluna(s) que nenhuma migration cria: ${ausentes.join(', ')}. `
    + 'Em produção isso vira "Could not find the \'<coluna>\' column ... in the schema cache" (PGRST204) '
    + 'e a importação inteira falha sem gravar nada.',
  ).toEqual([])
})

test('a migration que cria movement_fingerprint não pode estreitar o CHECK de formato', () => {
  // `bank_reconciliation_xlsx_review_schema.sql` recria o CHECK como
  // ('ofx','csv','xlsx') -- SEM 'brb'. Rodar essa migration depois da correção
  // do BRB desfaz a correção e volta o "Formato de extrato inválido".
  // Enquanto for assim, as migrations do BRB precisam ser as ÚLTIMAS da fila,
  // e este teste existe para que ninguém descubra isso em produção de novo.
  const sql = readFileSync(join(supabaseDir, 'bank_reconciliation_xlsx_review_schema.sql'), 'utf8')
  const estreita = /check \(source_format in \('ofx', 'csv', 'xlsx'\)\)/.test(sql)
  const avisa = /ordem|rodar por ultimo|executar antes|brb/i.test(sql)
  expect(
    !estreita || avisa,
    'A migration do XLSX estreita o CHECK de source_format sem avisar sobre a ordem. '
    + 'Quem rodar as migrations fora de ordem desfaz o suporte ao extrato do BRB.',
  ).toBe(true)
})
