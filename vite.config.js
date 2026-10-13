import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(() => {
  const databaseProxy = process.env.VITE_E2E_DB_PROXY_TARGET

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: 'https://surgimetrics.com.br',
          changeOrigin: true,
          secure: true,
        },
        ...(databaseProxy ? {
          '/rest/v1': {
            target:databaseProxy,
            changeOrigin:true,
            rewrite:path => path.replace(/^\/rest\/v1/, ''),
          },
        } : {}),
      },
    },
  }
})
