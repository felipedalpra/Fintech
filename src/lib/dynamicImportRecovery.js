export const DYNAMIC_IMPORT_RELOAD_KEY = 'surgimetrics_dynamic_import_reload'
export const DYNAMIC_IMPORT_RELOAD_COOLDOWN_MS = 60_000

function readLastReload(storage) {
  try {
    if (typeof storage?.getItem !== 'function') return null
    const value = Number(storage.getItem(DYNAMIC_IMPORT_RELOAD_KEY))
    return Number.isFinite(value) ? value : 0
  } catch {
    return null
  }
}

function rememberReload(storage, timestamp) {
  try {
    if (typeof storage?.setItem !== 'function') return false
    storage.setItem(DYNAMIC_IMPORT_RELOAD_KEY, String(timestamp))
    return true
  } catch {
    return false
  }
}

export function installDynamicImportRecovery(windowRef = globalThis.window, options = {}) {
  if (!windowRef?.addEventListener) return () => {}

  const now = options.now || Date.now
  const cooldownMs = options.cooldownMs || DYNAMIC_IMPORT_RELOAD_COOLDOWN_MS

  const handlePreloadError = event => {
    const timestamp = now()
    const lastReload = readLastReload(windowRef.sessionStorage)

    // Sem storage não há como garantir que um erro persistente não crie um loop.
    if (lastReload === null) return
    const reloadIsRecent = timestamp >= lastReload && timestamp - lastReload < cooldownMs
    if (reloadIsRecent) return
    if (!rememberReload(windowRef.sessionStorage, timestamp)) return

    event?.preventDefault?.()
    windowRef.location.reload()
  }

  windowRef.addEventListener('vite:preloadError', handlePreloadError)
  return () => windowRef.removeEventListener('vite:preloadError', handlePreloadError)
}
