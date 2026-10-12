import { expect, test } from '@playwright/test'

const DRAFT_KEY = 'surgimetrics_workspace_draft_e2e-user-id'

test('conta a receber exibe a origem digitada na receita extra', async ({ page }) => {
  const draft = {
    procedures:[], surgeries:[], consultations:[], products:[], productSales:[], productPurchases:[],
    extraRevenues:[{
      id:'extra-origin-e2e',
      description:'Mentoria',
      category:'outras_receitas',
      value:100,
      patient:'Julia Ribeiro',
      date:'',
      competenceDate:'2026-10-12',
      dueDate:'2026-11-12',
      receivedDate:null,
      status:'pendente',
      originLabel:'Instagram',
    }],
    expenses:[], assets:[], liabilities:[], goals:[],
  }

  await page.addInitScript(([draftKey, draftValue]) => {
    window.localStorage.setItem('surgimetrics_onboarded', 'true')
    window.sessionStorage.setItem(draftKey, draftValue)
  }, [DRAFT_KEY, JSON.stringify(draft)])

  await page.goto('/app/finance')
  await page.getByRole('button', { name:'A receber', exact:true }).click()

  const row = page.getByRole('row').filter({ hasText:'Mentoria' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('Instagram')
  await expect(row).not.toContainText('outra_receita')
})
