import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4187', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4187/api/health',
    env: { PORT: '4187', HOST: '127.0.0.1', APP_MODE: 'test', APP_ORIGIN: '', DATABASE_URL: '', AI_PROVIDER: 'local', GEMINI_API_KEY: '', MARKET_TRENDS_ENABLED: 'false', WORKER_INTERVAL_MS: '220', LOCAL_DATA_DIR: ':memory:', LOCAL_PASSWORD: 'demonstracao' },
    reuseExistingServer: false,
    timeout: 30000,
  },
})
