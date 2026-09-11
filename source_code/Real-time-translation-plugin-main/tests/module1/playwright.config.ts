import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'browser.spec.ts', workers: 1, retries: 0, timeout: 15000, outputDir: 'results/browser-artifacts', reporter: [['line'], ['json', { outputFile: 'results/browser.json' }]], use: { viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' } });
