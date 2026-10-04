import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'./tests/unit',
  timeout:10_000,
  retries:0,
})
