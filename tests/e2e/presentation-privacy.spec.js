import { expect, test } from '@playwright/test'

// Dados-sentinela: se QUALQUER um aparecer na tela com o modo apresentação ligado, vazou.
// É esse teste que separa "acho que cobri" de "está coberto".
const SENTINELAS = {
  email: 'e2e@surgimetrics.local',
  nomeConta: 'E2E User',
  paciente: 'Marcela Vasconcelos Ribeiro',
  membro: 'Jonas Concierge',
  emailMembro: 'jonas.concierge@clinicateste.com',
}

async function mock(page, { apresentacao = true } = {}) {
  await page.addInitScript(([liga]) => {
    try {
      window.localStorage.setItem('surgimetrics_onboarded', 'true')
      window.localStorage.setItem('surgimetrics_presentation_privacy', liga ? '1' : '0')
    } catch { /* ignore */ }
  }, [apresentacao])

  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    let body = []
    if (path.endsWith('/clinic_members')) {
      body = [{ id: 'M1', user_id: 'u-jonas', owner_id: 'e2e-user-id', clinic_id: 'C1',
        professional_name: SENTINELAS.membro, member_email: SENTINELAS.emailMembro,
        name: SENTINELAS.membro, email: SENTINELAS.emailMembro,
        role: 'equipe', status: 'ativo', clinical_access: true, created_at: new Date().toISOString() }]
    }
    if (path.endsWith('/clinics')) body = [{ id: 'C1', owner_id: 'e2e-user-id', name: 'Clinica E2E' }]
    if (path.endsWith('/opportunities')) {
      body = [{ id: 'O1', user_id: 'e2e-user-id', title: 'Rinoplastia', patient_name: SENTINELAS.paciente,
        stage: 'primeiro_contato', value: 25000, created_at: new Date().toISOString(),
        stage_entered_at: new Date().toISOString(), tags: [] }]
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/1' }, body: JSON.stringify(body) })
  })
  await page.route('**/rpc/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

/**
 * Texto visível da página inteira, do jeito que apareceria numa gravação de tela.
 *
 * Exige que a tela TENHA renderizado antes de ler. Sem isso, um `not.toContain` numa
 * página ainda vazia passa à toa — o teste de vazamento viraria uma máquina de verde falso.
 */
async function textoVisivel(page, { minimo = 200 } = {}) {
  await expect(page.getByTestId('presentation-toggle')).toBeVisible()
  await expect.poll(
    () => page.evaluate(() => document.body.innerText.length),
    { message: 'a tela não renderizou: o teste leria uma página vazia', timeout: 10000 },
  ).toBeGreaterThan(minimo)
  return page.evaluate(() => document.body.innerText)
}

test('o botão do modo apresentação existe no cabeçalho, ao lado do tema', async ({ page }) => {
  await mock(page, { apresentacao: false })
  await page.goto('/app')
  const botao = page.getByTestId('presentation-toggle')
  await expect(botao).toBeVisible()
  await expect(botao).toHaveAttribute('aria-pressed', 'false')
  await botao.click()
  await expect(botao).toHaveAttribute('aria-pressed', 'true')
})

test('com o modo ligado, o e-mail e o nome da conta não aparecem na tela', async ({ page }) => {
  await mock(page)
  await page.goto('/app')
  await expect(page.getByTestId('presentation-toggle')).toHaveAttribute('aria-pressed', 'true')
  const texto = await textoVisivel(page)
  expect(texto, 'o e-mail da conta vazou').not.toContain(SENTINELAS.email)
  expect(texto, 'o nome da conta vazou').not.toContain(SENTINELAS.nomeConta)
  expect(texto).toContain('•')
})

test('o modo sobrevive a um reload — gravação não pode reexibir dado no meio', async ({ page }) => {
  await mock(page)
  await page.goto('/app')
  await page.reload()
  const texto = await textoVisivel(page)
  expect(texto).not.toContain(SENTINELAS.email)
  await expect(page.getByTestId('presentation-toggle')).toHaveAttribute('aria-pressed', 'true')
})

test('nome e e-mail da equipe somem na aba Equipe', async ({ page }) => {
  await mock(page)
  await page.goto('/app/settings')
  await page.getByRole('button', { name: 'Equipe', exact: true }).first().click()
  // A lista tem que estar REALMENTE na tela: sem o cartao do membro, as assercoes abaixo
  // passariam sem exercitar nada -- foi exatamente o que aconteceu na primeira versao.
  await expect(page.getByTestId('team-member-M1')).toBeVisible()
  const texto = await textoVisivel(page)
  expect(texto, 'nome do membro vazou').not.toContain(SENTINELAS.membro)
  expect(texto, 'e-mail do membro vazou').not.toContain(SENTINELAS.emailMembro)
})

test('com o modo desligado os dados voltam — mascarar é só exibição', async ({ page }) => {
  // Se o dado não voltasse, teríamos destruído informação em vez de escondê-la.
  await mock(page, { apresentacao: false })
  await page.goto('/app')
  const texto = await textoVisivel(page)
  expect(texto).toContain(SENTINELAS.nomeConta)
})

test('valores aparecem como pontinhos, nao como uma fileira de X', async ({ page }) => {
  // 'R$ XXXXX' numa gravacao parece erro de renderizacao, nao dado protegido.
  await mock(page)
  await page.goto('/app')
  const texto = await textoVisivel(page)
  expect(texto).toContain('R$ \u2022')
  expect(texto).not.toContain('XXXXX')
})

test('o botao de ocultar valores explica por que nao funciona durante a apresentacao', async ({ page }) => {
  // Botao que recusa em silencio deixa a pessoa clicando sem entender.
  await mock(page)
  await page.goto('/app')
  const botao = page.getByRole('button', { name: /modo apresenta..o/i })
  await expect(botao).toBeVisible()
  await expect(botao).toBeDisabled()
  await expect(botao).toHaveAttribute('title', /olho do cabe/i)
})

test('desligar o olho revela os valores mesmo com o modo financeiro ligado', async ({ page }) => {
  // O controle do modo financeiro so existe no Dashboard: de outra tela, desligar o olho
  // precisava ser suficiente para voltar a enxergar.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('surgimetrics_onboarded', 'true')
      window.localStorage.setItem('surgimetrics_presentation_privacy', '1')
      window.localStorage.setItem('surgimetrics_financial_privacy', '1')
    } catch { /* ignore */ }
  })
  await page.route('**/api/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
  await page.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'content-range': '0-0/0' }, body: '[]' }))
  await page.goto('/app')
  await page.getByTestId('presentation-toggle').click()
  await expect.poll(() => page.evaluate(() => document.body.innerText.includes('R$ \u2022')),
    { timeout: 5000 }).toBe(false)
})
