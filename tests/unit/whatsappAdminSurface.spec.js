import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'

const root = process.cwd()

test('superfície administrativa não expõe dispatch ou sync geral por segredo de cron', () => {
  const source = fs.readFileSync(path.join(root, 'api/whatsapp.js'), 'utf8')

  expect(source).not.toContain("action === 'dispatch'")
  expect(source).not.toContain("action === 'meta-sync'")
  expect(source).not.toContain('req.query.owner')
})
