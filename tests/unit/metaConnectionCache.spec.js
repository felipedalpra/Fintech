// tests/unit/metaConnectionCache.spec.js
import { expect, test } from '@playwright/test'
import { clearMetaDataCache, shouldClearMetaCache } from '../../api/_lib/metaInsights.js'

test('shouldClearMetaCache: mesma conta de anúncio (ou ambas nulas) não limpa nada', () => {
  expect(shouldClearMetaCache(null, null)).toBe(false)
  expect(shouldClearMetaCache(undefined, null)).toBe(false)
  expect(shouldClearMetaCache('act_1', 'act_1')).toBe(false)
})

test('shouldClearMetaCache: conta de anúncio diferente (inclusive virando nula) limpa o cache', () => {
  // Achado real (14/11/2026): ao trocar a conta de anúncio conectada (ex.: Dra. Vitória → Dr.
  // Augusto), as tabelas de cache (meta_campaigns/meta_insights/...) não têm coluna
  // ad_account_id e nunca eram limpas — o dashboard continuava mostrando os dados antigos.
  expect(shouldClearMetaCache('act_1', 'act_2')).toBe(true)
  expect(shouldClearMetaCache('act_1', null)).toBe(true)
  expect(shouldClearMetaCache(null, 'act_1')).toBe(true)
})

function fakeSupabase() {
  const deletedTables = []
  return {
    deletedTables,
    from(table) {
      return {
        delete() {
          return {
            eq(column, value) {
              deletedTables.push({ table, column, value })
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }
}

test('clearMetaDataCache apaga todas as tabelas de cache do dono, nunca de outra clínica', async () => {
  const supabase = fakeSupabase()
  await clearMetaDataCache(supabase, 'owner-123')
  const tables = supabase.deletedTables.map(d => d.table).sort()
  expect(tables).toEqual(
    ['meta_adsets', 'meta_ads', 'meta_campaigns', 'meta_insights', 'meta_reach', 'meta_sync_runs'].sort(),
  )
  expect(supabase.deletedTables.every(d => d.column === 'user_id' && d.value === 'owner-123')).toBe(true)
})

test('clearMetaDataCache não lança se alguma tabela não existir (best-effort)', async () => {
  const supabase = {
    from() {
      return { delete() { return { eq() { return Promise.resolve({ error: { message: 'relation does not exist' } }) } } } }
    },
  }
  await expect(clearMetaDataCache(supabase, 'owner-123')).resolves.toBeUndefined()
})
