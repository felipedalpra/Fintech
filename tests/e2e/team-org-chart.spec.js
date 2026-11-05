import { expect, test } from '@playwright/test'

const OWNER = 'e2e-user-id' // ownerId do bypass E2E (VITE_E2E_USER_ID)

const MEMBERS = [
  { id:'m1', user_id:OWNER, member_email:'vitoria@x.com', role:'admin', clinical_access:true, professional_name:'Dra. Vitoria Ribeiro', professional_registration:'CRM-DF 29500', professional_council:'CRM', created_at:'2026-01-01T10:00:00Z' },
  { id:'m2', user_id:'u2', member_email:'augusto@x.com', role:'admin', clinical_access:true, professional_name:'Augusto Ribeiro', professional_registration:'CRM-DF 29501', professional_council:'CRM', created_at:'2026-01-02T10:00:00Z' },
  { id:'m3', user_id:'u3', member_email:'luh@x.com', role:'gestao', clinical_access:false, created_at:'2026-01-03T10:00:00Z' },
  { id:'m4', user_id:'u4', member_email:'jonas@x.com', role:'concierge', clinical_access:true, created_at:'2026-01-04T10:00:00Z' },
]

async function mockTeam(page, role) {
  await page.addInitScript(r => window.localStorage.setItem('surgimetrics_e2e_role', r), role)
  await page.route('**/api/google/calendar?action=status', route => route.fulfill({ status:200, contentType:'application/json', body:'{"configured":false,"connected":false}' }))
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    const body = path.endsWith('/clinic_members') && route.request().method() === 'GET' ? MEMBERS : []
    return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) })
  })
}

test('admin vê o organograma com hierarquia por perfil e as capacidades de cada um', async ({ page }) => {
  await mockTeam(page, 'admin')
  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Equipe', exact:true }).click()

  await page.getByRole('button', { name:'Organograma', exact:true }).click()
  const chart = page.getByTestId('team-org-chart')
  await expect(chart).toBeVisible()

  // A dona encabeça e é identificada como tal.
  await expect(chart.getByText('DONA DA CLÍNICA')).toBeVisible()
  await expect(chart.getByText('Dra. Vitoria Ribeiro')).toBeVisible()

  // Grupos por perfil, sem caixa para perfil sem ninguém.
  await expect(chart.getByText('Administrador · 1')).toBeVisible()
  await expect(chart.getByText('Gestão · 1')).toBeVisible()
  await expect(chart.getByText('Concierge · 1')).toBeVisible()
  await expect(chart.getByText(/^Equipe · /)).toHaveCount(0)

  // As capacidades aparecem sem precisar abrir cada pessoa.
  await expect(chart.getByText('sem prontuário')).toBeVisible()
  await expect(chart.getByText('assina · CRM CRM-DF 29501')).toBeVisible()
  await expect(chart.getByText('4 pessoa(s)', { exact:false })).toBeVisible()
})

test('clicar em alguém no organograma leva para a lista, onde a edição acontece', async ({ page }) => {
  await mockTeam(page, 'admin')
  await page.goto('/app/settings')
  await page.getByRole('button', { name:'Equipe', exact:true }).click()
  await page.getByRole('button', { name:'Organograma', exact:true }).click()

  await page.getByTestId('team-org-chart').getByText('jonas@x.com').first().click()

  // Volta para a lista com os controles reais — o organograma nunca escreve.
  await expect(page.getByTestId('team-org-chart')).toHaveCount(0)
  await expect(page.getByTestId('team-member-m4')).toBeVisible()
  await expect(page.getByTestId('team-member-m4').getByText('Acesso ao prontuário clínico')).toBeVisible()
})

test('gestão não chega nem em Configurações, então não vê o organograma', async ({ page }) => {
  // O organograma é de Administrador. A primeira barreira é a própria aba Configurações, que
  // Gestão não acessa — asserção direta, em vez de um `if` que passaria sem verificar nada.
  await mockTeam(page, 'gestao')
  await page.goto('/app/settings')
  await expect(page.getByRole('button', { name:'Configurações', exact:true })).toHaveCount(0)
  await expect(page.getByRole('button', { name:'Organograma', exact:true })).toHaveCount(0)
  await expect(page.getByTestId('team-org-chart')).toHaveCount(0)
})
