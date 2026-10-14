import { expect, test } from '@playwright/test'
import { buildCheckoutUrl, buildSignupUrl } from '../../src/billing/plans.js'

test('links de cadastro preservam o plano sem parâmetros de trial', () => {
  expect(buildSignupUrl('semestral', 'doutora@clinica.com')).toBe('/signup?cycle=semestral&email=doutora%40clinica.com')
  expect(buildCheckoutUrl('anual')).toBe('/signup?cycle=anual')
  expect(buildCheckoutUrl('mensal')).not.toContain('trial')
})
