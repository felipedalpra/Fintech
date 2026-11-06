import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// O host canônico é o www, que é o único com certificado e atendido pela Vercel. Apontar
// metadado público para o apex manda o robô (Meta, Google) para um endereço que não responde.
const CANONICO = 'https://www.surgimetrics.com.br'
const ler = p => readFileSync(join(process.cwd(), p), 'utf8')

test('nenhum metadado público aponta para o apex sem certificado', () => {
  for (const arquivo of ['index.html', 'public/robots.txt', 'public/sitemap.xml']) {
    const texto = ler(arquivo)
    const apex = texto.match(/https:\/\/surgimetrics\.com\.br/g) ?? []
    expect(apex, `${arquivo} ainda aponta para o apex`).toEqual([])
  }
})

test('a home traz as quatro metatags Open Graph exigidas, com imagem absoluta', () => {
  const html = ler('index.html')
  for (const prop of ['og:title', 'og:description', 'og:url', 'og:image']) {
    expect(html, `falta ${prop}`).toContain(`property="${prop}"`)
  }
  const og = p => html.match(new RegExp(`property="${p}" content="([^"]+)"`))?.[1]
  expect(og('og:url')).toBe(`${CANONICO}/`)
  // Imagem relativa é ignorada por vários scrapers: tem que ser URL absoluta.
  expect(og('og:image')).toMatch(/^https:\/\//)
  expect(og('og:image')).toContain('www.surgimetrics.com.br')
})

test('o arquivo apontado por og:image existe no diretório publicado', () => {
  // Uma URL bonita apontando para arquivo inexistente dá preview quebrado, que é pior
  // que preview sem imagem: parece que o site está fora do ar.
  const html = ler('index.html')
  const url = html.match(/property="og:image" content="([^"]+)"/)?.[1]
  const caminho = url.replace(/^https:\/\/[^/]+/, '')
  expect(() => ler(`public${caminho}`)).not.toThrow()
})

test('robots.txt não bloqueia o robô da Meta', () => {
  const robots = ler('public/robots.txt')
  expect(robots).toMatch(/User-agent:\s*\*/i)
  expect(robots).toMatch(/Allow:\s*\//i)
  expect(robots).not.toMatch(/Disallow:\s*\/\s*$/im)
  expect(robots.toLowerCase()).not.toContain('facebookexternalhit\nuser-agent')
})
