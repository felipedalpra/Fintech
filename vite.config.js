import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const databaseProxy = process.env.VITE_E2E_DB_PROXY_TARGET

  if (mode === 'production' && process.env.VITE_E2E_BYPASS_AUTH === 'true') {
    throw new Error('VITE_E2E_BYPASS_AUTH não pode ser habilitado em build de produção.')
  }

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: 'https://www.surgimetrics.com.br',
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
