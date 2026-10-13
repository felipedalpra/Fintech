import { defineConfig } from '@playwright/test'

const databaseProxy = process.env.E2E_DATABASE_PROXY || 'http://127.0.0.1:54329'
const anonKey = process.env.E2E_SUPABASE_ANON_KEY || 'local-e2e-key'
const userId = process.env.E2E_USER_ID || '11111111-1111-4111-8111-111111111111'

export default defineConfig({
  testDir:'./tests/e2e-real',
  outputDir:'test-results/e2e-real',
  timeout:90_000,
  expect:{ timeout:10_000 },
  retries:0,
  workers:1,
  use:{
    baseURL:'http://127.0.0.1:4174',
    headless:true,
    actionTimeout:10_000,
    screenshot:'only-on-failure',
    trace:'retain-on-failure',
  },
  webServer:{
    command:[
      'VITE_E2E_BYPASS_AUTH=true',
      `VITE_E2E_USER_ID=${userId}`,
      'VITE_E2E_CLINIC_ID=22222222-2222-4222-8222-222222222222',
      'VITE_SUPABASE_URL=http://127.0.0.1:4174',
      `VITE_SUPABASE_ANON_KEY=${anonKey}`,
      `VITE_E2E_DB_PROXY_TARGET=${databaseProxy}`,
      'npm run dev -- --host 127.0.0.1 --port 4174',
    ].join(' '),
    url:'http://127.0.0.1:4174',
    reuseExistingServer:false,
    timeout:120_000,
  },
})
