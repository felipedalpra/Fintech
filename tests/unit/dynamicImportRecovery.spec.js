import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DYNAMIC_IMPORT_RELOAD_KEY,
  installDynamicImportRecovery,
} from '../../src/lib/dynamicImportRecovery.js'

function createWindow({ storedAt = null, storageError = false } = {}) {
  const listeners = new Map()
  const values = new Map()
  const windowRef = {
    listeners,
    reloads: 0,
  }
  if (storedAt !== null) values.set(DYNAMIC_IMPORT_RELOAD_KEY, String(storedAt))

  Object.assign(windowRef, {
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type)
    },
    sessionStorage: {
      getItem(key) {
        if (storageError) throw new Error('storage indisponível')
        return values.get(key) ?? null
      },
      setItem(key, value) {
        if (storageError) throw new Error('storage indisponível')
        values.set(key, value)
      },
    },
    location: {
      reload: () => { windowRef.reloads += 1 },
    },
  })
  return windowRef
}

test('erro de chunk depois de deploy recarrega a aplicação uma vez', () => {
  const windowRef = createWindow()
  let prevented = false
  installDynamicImportRecovery(windowRef, { now: () => 100_000 })

  windowRef.listeners.get('vite:preloadError')({ preventDefault: () => { prevented = true } })

  expect(windowRef.reloads).toBe(1)
  expect(prevented).toBe(true)
  expect(windowRef.sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY)).toBe('100000')
})

test('falha repetida dentro do intervalo não entra em loop de reload', () => {
  const windowRef = createWindow({ storedAt:99_500 })
  let prevented = false
  installDynamicImportRecovery(windowRef, { now: () => 100_000 })

  windowRef.listeners.get('vite:preloadError')({ preventDefault: () => { prevented = true } })

  expect(windowRef.reloads).toBe(0)
  expect(prevented).toBe(false)
})

test('storage indisponível mantém o erro visível em vez de arriscar loop', () => {
  const windowRef = createWindow({ storageError:true })
  installDynamicImportRecovery(windowRef, { now: () => 100_000 })

  expect(() => windowRef.listeners.get('vite:preloadError')({ preventDefault() {} })).not.toThrow()
  expect(windowRef.reloads).toBe(0)
})

test('relógio corrigido para trás não bloqueia a recuperação indefinidamente', () => {
  const windowRef = createWindow({ storedAt:200_000 })
  installDynamicImportRecovery(windowRef, { now: () => 100_000 })

  windowRef.listeners.get('vite:preloadError')({ preventDefault() {} })

  expect(windowRef.reloads).toBe(1)
})

test('fallback SPA cobre rotas reais sem capturar assets inexistentes', () => {
  const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'))
  const sources = config.rewrites.map(rule => rule.source)

  expect(sources).toContain('/app/(.*)')
  expect(sources).toContain('/anamnese/(.*)')
  expect(sources).not.toContain('/(.*)')
  expect(sources.some(source => source.includes('assets'))).toBe(false)
})
