/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The FastAPI app serves ../static as its document root, so that is where the
// production bundle lands. In development Vite serves the UI itself and proxies
// the API and WebSocket to a locally running `python -m web.server`.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8501',
      '/ws': { target: 'ws://127.0.0.1:8501', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
})
