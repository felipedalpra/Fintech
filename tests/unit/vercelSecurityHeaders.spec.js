import fs from 'node:fs'
import { test, expect } from '@playwright/test'

test('Vercel publica headers HTTP básicos de proteção', () => {
  const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'))
  const headers = config.headers.find(item => item.source === '/(.*)').headers
  const values = Object.fromEntries(headers.map(item => [item.key, item.value]))

  expect(values['X-Content-Type-Options']).toBe('nosniff')
  expect(values['X-Frame-Options']).toBe('DENY')
  expect(values['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  expect(values['Permissions-Policy']).toContain('camera=()')
  expect(values['Strict-Transport-Security']).toContain('max-age=31536000')
})
