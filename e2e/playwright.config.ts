import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: './.tmp/results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3101', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run build && ./e2e/start-server.sh',
      cwd: '..',
      url: 'http://127.0.0.1:3101/api/health',
      timeout: 180_000,
      reuseExistingServer: false,
    },
    // a stand-in for the Anthropic API (never the real one)
    { command: 'node e2e/ai-stub.mjs', cwd: '..', url: 'http://127.0.0.1:3102/health' },
  ],
});
