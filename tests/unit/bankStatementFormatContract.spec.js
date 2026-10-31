import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

// ---------------------------------------------------------------------------
// Contrato cliente <-> banco para `source_format`
// ---------------------------------------------------------------------------
// Este arquivo existe por causa de um bug em producao (31/10/2026): o leitor do
// extrato do BRB passou a devolver `source_format = 'brb'`, e a migration
// corrigiu o guard do RPC -- mas so numa das DUAS overloads de
// `start_bank_statement_import`. Sao assinaturas diferentes (5 e 6 parametros),
// e o app chama a de 6, que continuou recusando. O usuario via a previa correta
// na tela e perdia tudo no clique de confirmar.
//
// A conferencia manual que fizemos no banco contou "1 funcao com brb" e parecia
// sucesso -- era 1 de 2. Nenhum teste pegava isso porque os E2E mockam o RPC.
//
// O invariante aqui e estatico e roda sem banco: para CADA assinatura do RPC
// precisa existir uma migration que aceite TODOS os formatos que o cliente
// consegue produzir. Migrations antigas com listas menores sao historico
// legitimo e nao reprovam -- o que reprova e uma assinatura que NENHUMA
// migration atualizou.

// `process.cwd()` e a raiz do repositorio: o Playwright transpila este arquivo
// para CJS, onde `import.meta.url` nao existe.
const supabaseDir = join(process.cwd(), 'supabase')

// Todo formato que `parseStatementText`/`parsePdfStatement` sabem devolver.
const FORMATOS_DO_CLIENTE = ['ofx', 'csv', 'xlsx', 'brb']

function lerMigrations() {
  return readdirSync(supabaseDir)
    .filter(name => name.endsWith('.sql'))
    .map(name => ({ name, sql:readFileSync(join(supabaseDir, name), 'utf8') }))
}

// Cada `create or replace function ... start_bank_statement_import(...)`, com a
// assinatura (quantidade de parametros) e a lista de formatos do seu guard.
function definicoesDoRpc() {
  const definicoes = []
  for (const { name, sql } of lerMigrations()) {
    const padrao = /create or replace function public\.start_bank_statement_import\(([\s\S]*?)\)\s*returns([\s\S]*?)\n\$\$;/g
    let match
    while ((match = padrao.exec(sql)) !== null) {
      const parametros = match[1].split(',').map(p => p.trim()).filter(Boolean)
      const guard = /p_format not in \(([^)]*)\)/.exec(match[2])
      definicoes.push({
        arquivo:name,
        aridade:parametros.length,
        formatos:guard
          ? guard[1].split(',').map(valor => valor.trim().replace(/^'|'$/g, ''))
          : null,
      })
    }
  }
  return definicoes
}

test('o RPC de importação tem as assinaturas que esperamos', () => {
  const definicoes = definicoesDoRpc()
  expect(definicoes.length, 'nenhuma definição encontrada: o regex ou o nome mudou').toBeGreaterThan(0)
  expect(definicoes.every(definicao => definicao.formatos), 'definição sem guard de formato').toBe(true)
})

test('toda assinatura do RPC aceita todos os formatos que o cliente produz', () => {
  const definicoes = definicoesDoRpc()
  const aridades = [...new Set(definicoes.map(definicao => definicao.aridade))]

  for (const aridade of aridades) {
    const desta = definicoes.filter(definicao => definicao.aridade === aridade)
    // Basta UMA migration cobrir todos os formatos: ela é a que vale no banco.
    const completa = desta.find(definicao =>
      FORMATOS_DO_CLIENTE.every(formato => definicao.formatos.includes(formato)))
    expect(
      completa,
      `Nenhuma migration atualiza a assinatura de ${aridade} parâmetros de start_bank_statement_import `
      + `para aceitar [${FORMATOS_DO_CLIENTE.join(', ')}]. Encontrado: `
      + desta.map(definicao => `${definicao.arquivo} -> [${definicao.formatos.join(', ')}]`).join(' | ')
      + '. Uma assinatura esquecida é aceita pelo PostgREST e recusa a importação em produção.',
    ).toBeTruthy()
  }
})

test('o CHECK da coluna source_format acompanha os mesmos formatos', () => {
  const migrations = lerMigrations()
  const checks = migrations.flatMap(({ name, sql }) =>
    [...sql.matchAll(/check \(source_format in \(([^)]*)\)\)/g)]
      .map(match => ({ arquivo:name, formatos:match[1].split(',').map(v => v.trim().replace(/^'|'$/g, '')) })))
  expect(checks.length, 'nenhum CHECK de source_format encontrado').toBeGreaterThan(0)
  const completa = checks.find(check => FORMATOS_DO_CLIENTE.every(formato => check.formatos.includes(formato)))
  expect(
    completa,
    'Nenhuma migration amplia o CHECK de source_format para todos os formatos do cliente. '
    + checks.map(check => `${check.arquivo} -> [${check.formatos.join(', ')}]`).join(' | '),
  ).toBeTruthy()
})
