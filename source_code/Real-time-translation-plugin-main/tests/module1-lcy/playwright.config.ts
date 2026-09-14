import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
const out = resolve(process.env.LCY_RESULTS ?? 'tests/module1-lcy/results');
export default defineConfig({ testDir: '.', testMatch: 'browser.spec.ts', workers: 1, retries: 0, timeout: 15000, outputDir: resolve(out, 'browser-artifacts'), reporter: [['line'], ['json', { outputFile: resolve(out, 'browser.json') }]], use: { headless: true, viewport: { width: 1280, height: 800 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' } });
