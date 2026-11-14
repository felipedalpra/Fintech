// tests/unit/metaSyncMissingAdAccount.spec.js
import { expect, test } from '@playwright/test'
import { syncMetaInsights } from '../../api/_lib/metaInsights.js'

const originalEnv = { ...process.env }
test.afterEach(() => { process.env = { ...originalEnv } })

// Chain fake mínima: suporta .from('meta_connections').select().in().not().eq(), thenable.
function fakeSupabaseForSync(rows) {
  return {
    from(table) {
      if (table !== 'meta_connections') throw new Error(`tabela inesperada neste teste: ${table}`)
      const builder = {
        select() { return builder },
        in() { return builder },
        not() { return builder },
        eq() { return builder },
        then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject) },
      }
      return builder
    },
  }
}

test('syncMetaInsights reporta como FALHA (não sucesso silencioso) uma conexão sem conta de anúncios selecionada', async () => {
  // Achado real (14/11/2026): o filtro .not('ad_account_id','is',null) excluía essa clínica da
  // consulta ANTES de tentar sincronizar — o resumo voltava { owners:0, failures:0 }, e
  // "Atualizar agora" (handleMetaSyncRange) não via motivo nenhum pra mostrar erro. O botão
  // parecia funcionar mas não fazia nada, e a tela continuava com dado antigo em cache.
  process.env.META_GRAPH_VERSION = 'v26.0'
  // access_token_encrypted propositalmente "inválido": uma conexão sem ad_account_id nunca
  // deve chegar a ser descriptografada — é descartada antes disso, então nem precisa de uma
  // chave de criptografia configurada neste teste.
  const row = {
    user_id: 'owner-1',
    ad_account_id: null,
    access_token_encrypted: { data: 'não importa, nunca deve ser lido' },
    token_expires_at: null,
  }
  const supabase = fakeSupabaseForSync([row])

  const summary = await syncMetaInsights(supabase, { owner: 'owner-1' })

  expect(summary.ok).toBe(true)
  expect(summary.owners).toBe(1)
  expect(summary.synced).toBe(0)
  expect(summary.failures).toBe(1)
  expect(summary.details).toEqual([{ owner: 'owner-1', error: expect.stringContaining('conta de anúncios') }])
})
