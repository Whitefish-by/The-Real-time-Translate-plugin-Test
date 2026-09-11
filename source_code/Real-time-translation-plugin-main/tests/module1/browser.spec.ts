import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { DEFAULT_SETTINGS } from '../../packages/shared/src/index';
let context: BrowserContext;
let extensionId: string;
test.beforeAll(async () => { const path = resolve('apps/extension/dist'); context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`] }); let [worker] = context.serviceWorkers(); worker ??= await context.waitForEvent('serviceworker'); extensionId = new URL(worker.url()).host; });
test.beforeEach(async () => { const setup = await context.newPage(); await setup.goto(`chrome-extension://${extensionId}/options.html`); await setup.evaluate(async (settings) => { await chrome.runtime.sendMessage({ type: 'settings:set', settings }); }, DEFAULT_SETTINGS); await setup.close(); });
test.afterAll(async () => { await context?.close(); });
test.afterEach(async ({}, info) => { for (const page of context.pages()) {
    if (info.status !== info.expectedStatus)
        await page.screenshot({ path: info.outputPath('failure.png') });
    await page.close();
} });
test('M1-034 Chrome 设置保存后重新加载', async ({}, info) => { const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/options.html`); await expect(page.locator('#font')).toHaveValue('24'); for (const x of await page.locator('input[name="sourceLanguage"]').all())
    await x.uncheck(); await page.locator('input[value="en-US"]').check(); await page.locator('#font').fill('30'); await page.getByRole('button', { name: '保存设置' }).click(); await expect(page.locator('#message')).toHaveText('设置已保存'); await page.reload(); await expect(page.locator('#font')).toHaveValue('30'); await expect(page.locator('input[name="sourceLanguage"]:checked')).toHaveCount(1); await page.screenshot({ path: info.outputPath('settings.png'), fullPage: true }); });
test('M1-035 Chrome 拒绝空源语言', async () => { const page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/options.html`); await expect(page.locator('#font')).toHaveValue('24'); for (const x of await page.locator('input[name="sourceLanguage"]').all())
    await x.uncheck(); await page.getByRole('button', { name: '保存设置' }).click(); await expect(page.locator('#message')).toHaveClass('error'); await page.reload(); await expect(page.locator('input[name="sourceLanguage"]:checked')).toHaveCount(10); });
// Browser harness executes the built content script; only the Chrome message transport is stubbed.
// Closed ShadowRoot remains closed in production; the harness retains the reference for assertions.
async function contentPage() { const page = await context.newPage(); await page.route('http://module1.test/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>模块一字幕测试</title><h1>本地字幕显示验证</h1><p>固定测试文本，不执行语音识别</p>' })); await page.goto('http://module1.test/'); await page.evaluate(settings => { const w = window as any; const original = Element.prototype.attachShadow; Element.prototype.attachShadow = function (init) { const result = original.call(this, init); w.testShadow = result; return result; }; w.chrome = { runtime: { onMessage: { addListener: (cb: any) => { w.dispatchContent = cb; } }, sendMessage: async () => settings } }; }, DEFAULT_SETTINGS); await page.addScriptTag({ path: resolve('apps/extension/dist/content.js') }); return page; }
async function send(page: Page, revision: number, isFinal = false) { await page.evaluate(({ settings, revision, isFinal }) => (window as any).dispatchContent({ type: 'content:subtitle', settings, event: { type: 'subtitle', sessionId: '00000000-0000-4000-8000-000000000000', segmentId: 's1', generation: 0, revision, isFinal, sourceLanguage: 'en-US', sourceText: `hello ${revision}`, translatedText: `你好 ${revision}`, audioStartMs: 0, audioEndMs: 500 } }), { settings: DEFAULT_SETTINGS, revision, isFinal }); }
const texts = (page: Page) => page.evaluate(() => [...(window as any).testShadow.querySelectorAll('.segment.visible')].map((e: any) => e.textContent));
test('M1-036 字幕浮层显示双语文本', async ({}, info) => { const page = await contentPage(); await send(page, 1); expect(await texts(page)).toEqual(['hello 1你好 1']); await page.screenshot({ path: info.outputPath('subtitle.png') }); });
test('M1-037 字幕浮层最终片段保持固定', async () => { const page = await contentPage(); await send(page, 2, true); await send(page, 3); expect(await texts(page)).toEqual(['hello 2你好 2']); });
test('M1-038 停止状态清空字幕浮层', async () => { const page = await contentPage(); await send(page, 1); await page.evaluate(() => (window as any).dispatchContent({ type: 'content:state', state: { state: 'idle' } })); expect(await texts(page)).toEqual([]); });
