import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const canonical = readFileSync(join(root, 'supabase', 'whatsapp_evolution_provider_schema.sql'), 'utf8')
const migration = readFileSync(join(root, 'supabase', 'whatsapp_media_queue_schema.sql'), 'utf8')

test('o contrato do banco aceita e indexa os estados da fila de mídia', () => {
  for (const sql of [canonical, migration]) {
    expect(sql).toContain('media_pending')
    expect(sql).toContain('media_processing')
  }
  expect(canonical).toMatch(/processing_status in \([^)]*media_pending[^)]*media_processing/i)
  expect(migration).toContain('drop constraint if exists whatsapp_webhook_events_processing_status_check')
})
