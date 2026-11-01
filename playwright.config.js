import { defineConfig } from '@playwright/test'

const port = process.env.E2E_PORT || '4173'
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir:'./tests/e2e',
  timeout:45_000,
  retries:0,
  // Um unico worker: varios navegadores contra o dev server frio estouram o timeout.
  workers:1,
  use:{
    baseURL,
    headless:true,
  },
  webServer:{
    command:`VITE_E2E_BYPASS_AUTH=true npm run dev -- --host 127.0.0.1 --port ${port}`,
    url:baseURL,
    reuseExistingServer:true,
    timeout:120_000,
  },
})
