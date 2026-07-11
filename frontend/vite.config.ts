import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // next-auth/react touches process.env at module scope — shim for the browser
  define: { 'process.env': {} },
  server: {
    // F-15: same-origin /api/* in dev — proxies to the JanNaadi backend (Next.js).
    // Session cookies stay host-only on localhost, so Auth.js works unchanged.
    // Override target with VITE_API_TARGET (e.g. http://localhost:3100 for the
    // standalone verify server).
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: false,
      },
      '/healthz': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
})
