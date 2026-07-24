import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy /api to backend in dev — avoids CORS issues when using the proxy.
      // Frontend uses VITE_API_BASE_URL directly; this proxy is optional.
    },
  },
})
