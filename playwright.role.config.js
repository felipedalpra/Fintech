import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'./tests/e2e',
  testMatch:'role-access.spec.js',
  timeout:45_000,
  workers:1,
  use:{ baseURL:'http://127.0.0.1:4174', headless:true },
  webServer:{
    command:'VITE_E2E_BYPASS_AUTH=true VITE_E2E_ROLE=equipe npm run dev -- --host 127.0.0.1 --port 4174',
    url:'http://127.0.0.1:4174',
    reuseExistingServer:false,
    timeout:120_000,
  },
})
