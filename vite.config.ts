import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// GitHub Pages serves the app from https://andyayas.github.io/automator/.
export default defineConfig({
  base: '/automator/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __BUILD_SHA__: JSON.stringify((process.env.GITHUB_SHA ?? 'local').slice(0, 7)),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'supabase/functions/**/*.test.ts'],
    // Integration tests hit the live project; only `npm run test:integration` runs them.
    exclude: process.env.INTEGRATION ? ['node_modules/**'] : ['node_modules/**', 'src/**/*.integration.test.ts'],
    // Test-only logins from .env.local; never VITE_-prefixed, so never in the bundle.
    env: process.env.INTEGRATION ? loadEnv('test', process.cwd(), 'RLS_TEST_') : {},
  },
})
