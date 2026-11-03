import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const sql = fs.readFileSync(path.resolve('supabase/receivable_payment_reversal.sql'), 'utf8')

test('RPC de estorno é transacional, autorizada e preserva os dados da origem', () => {
  expect(sql).toContain('security definer')
  expect(sql).toContain('public.finance_role_can_manage()')
  expect(sql).toContain('for update of installment')
  expect(sql).toMatch(/from public\.financial_entries[\s\S]*for update;/)
  expect(sql).toContain("using errcode = '40001'")
  expect(sql).toContain("->> 'chargeId'")
  expect(sql).toContain("<> 'reversed'")
  expect(sql).toContain("status = 'pending'")
  expect(sql).toContain('source_installment_number <> p_source_installment_number')
  expect(sql).toContain('public.try_payment_schedule')
  expect(sql).toMatch(/order by item\.value ->> 'date', item\.ordinality/)
  expect(sql).toContain("pg_get_functiondef(webhook_oid)")
  expect(sql).toContain("apply_billing_webhook_event precisa existir antes desta migration")
  expect(sql).toContain("substring(coalesce(p_method, '') from 12)")
  expect(sql).not.toMatch(/\bdelete\s+from\b/i)
  expect(sql).not.toMatch(/\btruncate\b/i)
})

test('data de recebimento ignora settlements revertidos inclusive em refund de webhook', () => {
  expect(sql).toContain("coalesce(value ->> 'status', 'received') <> 'reversed'")
  expect(sql).toContain('before update of receipt_settlements on public.surgeries')
  expect(sql).toContain('before update of receipt_settlements on public.consultations')
  expect(sql).toContain('before update of receipt_settlements on public.product_sales')

  const billing = fs.readFileSync(path.resolve('supabase/billing_charges_schema.sql'), 'utf8')
  expect(billing.match(/public\.latest_active_receipt_date\(settlements_after\)/g)).toHaveLength(3)
  expect(billing).toContain('coalesce(installment_now.source_installment_number, installment_now.installment_number)::text')
  expect(billing).toContain('coalesce(source_installment_number, installment_number)::text')

  const backend = fs.readFileSync(path.resolve('api/_lib/billing.js'), 'utf8')
  expect(backend).toContain('source_installment_number || installment.installment_number')
  expect(backend).toContain('A identidade da parcela mudou')
})
