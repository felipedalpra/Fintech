import { expect, test } from '@playwright/test'
import { providerAvailable } from '../../api/_lib/whatsappProvider.js'

test('Evolution só pode enviar quando a instância está realmente aberta', () => {
  const base = { active:true, provider:'evolution', provider_instance_name:'clinic-n1' }
  expect(providerAvailable({ ...base, connection_state:'open' })).toBe(true)
  expect(providerAvailable({ ...base, connection_state:'connecting' })).toBe(false)
  expect(providerAvailable({ ...base, connection_state:'close' })).toBe(false)
  expect(providerAvailable({ ...base, connection_state:'open', archived_at:'2026-10-27T20:00:00Z' })).toBe(false)
  expect(providerAvailable({ ...base, connection_state:'open', active:false })).toBe(false)
})

test('Z-API legado preserva a validação por credenciais e estado conhecido', () => {
  const base = { active:true, provider:'zapi', instance_url:'https://example.test/instance', api_token:'token' }
  expect(providerAvailable(base)).toBe(true)
  expect(providerAvailable({ ...base, connection_state:'error' })).toBe(false)
  expect(providerAvailable({ ...base, api_token:'' })).toBe(false)
})
