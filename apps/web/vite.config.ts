/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // shared-types compiles to CommonJS for the API's plain-Node runtime.
      // The browser can't run CommonJS and Vite's dev server serves linked
      // workspace packages as-is, so point the web app at the TS source
      // instead (Vite compiles it like any other app file). This also means
      // edits to shared-types show up in the web app without a rebuild.
      '@kyvera/shared-types': fileURLToPath(
        new URL('../../packages/shared-types/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
