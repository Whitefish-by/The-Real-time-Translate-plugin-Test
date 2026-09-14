import { test, expect, type Page } from '@playwright/test';
import { WebSocketServer, type WebSocket as WsPeer } from 'ws';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { DEFAULT_SETTINGS, type ExtensionSettings, type SubtitleEvent } from '../../packages/shared/src/index';
const sid = '11111111-1111-4111-8111-111111111111';
const event: SubtitleEvent = { type: 'subtitle', sessionId: sid, segmentId: 's1', generation: 0, revision: 1, sourceLanguage: 'en-US', sourceText: 'Hello', translatedText: '你好', isFinal: false, audioStartMs: 0, audioEndMs: 40 };
async function content(page: Page) {
  await page.route('http://lcy.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>字幕补充测试</title><div id="screen"><h1>字幕显示验证</h1><button id="fullscreen">进入全屏</button></div><script>document.querySelector("#fullscreen").onclick=()=>document.querySelector("#screen").requestFullscreen()</script>' }));
  await page.goto('http://lcy.test/');
  await page.evaluate(settings => {
    const w = window as any; const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) { const shadow = original.call(this, init); w.testShadow = shadow; return shadow; };
    w.chrome = { runtime: { onMessage: { addListener: (callback: any) => { w.dispatchContent = callback; } }, sendMessage: async () => settings } };
  }, DEFAULT_SETTINGS);
  await page.addScriptTag({ path: resolve('apps/extension/dist/content.js') });
}
async function send(page: Page, settings: Partial<ExtensionSettings>, patch: Partial<SubtitleEvent> = {}) {
  await page.evaluate(data => (window as any).dispatchContent({ type: 'content:subtitle', ...data }), { settings: { ...DEFAULT_SETTINGS, ...settings }, event: { ...event, ...patch } });
}
const texts = (page: Page) => page.evaluate(() => [...(window as any).testShadow.querySelectorAll('.segment.visible')].map((e: HTMLElement) => e.textContent));
test('M1-054 仅原文模式隐藏译文', async ({ page }, info) => { await content(page); await send(page, { displayMode: 'source' }); expect(await texts(page)).toEqual(['Hello']); await page.screenshot({ path: info.outputPath('source-only.png') }); });
test('M1-055 仅译文模式显示翻译结果', async ({ page }, info) => { await content(page); await send(page, { displayMode: 'translation' }); expect(await texts(page)).toEqual(['你好']); await page.screenshot({ path: info.outputPath('translation-only.png') }); });
test('M1-056 仅译文模式在译文缺失时回退原文', async ({ page }) => { await content(page); await send(page, { displayMode: 'translation' }, { translatedText: null }); expect(await texts(page)).toEqual(['Hello']); });
test('M1-057 字幕中的 HTML 作为纯文本显示', async ({ page }) => {
  await content(page); const payload = '<img src=x onerror="window.injected=true">';
  await send(page, { displayMode: 'source' }, { sourceText: payload });
  expect(await texts(page)).toEqual([payload]);
  expect(await page.evaluate(() => ({ injected: Boolean((window as any).injected), images: (window as any).testShadow.querySelectorAll('img').length }))).toEqual({ injected: false, images: 0 });
});
test('M1-058 进入并退出全屏时字幕跟随显示', async ({ page }, info) => {
  await content(page); await send(page, {}); await page.locator('#fullscreen').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id)).toBe('screen');
  expect(await page.evaluate(() => document.querySelector('#live-bilingual-subtitles-root')?.parentElement === document.fullscreenElement)).toBe(true);
  expect(await texts(page)).toEqual(['Hello你好']); await page.screenshot({ path: info.outputPath('fullscreen.png') });
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.querySelector('#live-bilingual-subtitles-root')?.parentElement === document.documentElement)).toBe(true);
  expect(await page.locator('#live-bilingual-subtitles-root').count()).toBe(1); expect(await texts(page)).toEqual(['Hello你好']);
});
async function nativeClient(page: Page) {
  const http = createServer((_request, response) => response.end('<!doctype html><meta charset="utf-8"><title>本地客户端测试</title>'));
  const server = new WebSocketServer({ server: http });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  let peer: WsPeer | undefined; const closeCodes: number[] = [];
  server.on('connection', socket => { peer = socket; socket.on('close', code => closeCodes.push(code)); socket.on('message', (raw, binary) => { if (!binary && JSON.parse(raw.toString()).type === 'hello') socket.send(JSON.stringify({ type: 'ready', sessionId: sid, provider: 'test-server' })); }); });
  const address = http.address(); if (!address || typeof address === 'string') throw Error('Expected TCP address');
  await page.goto(`http://127.0.0.1:${address.port}`); await page.addScriptTag({ path: resolve('tests/module1-lcy/generated/client.js') });
  await page.evaluate(({ settings, sessionId }) => {
    const w = window as any; const Native = WebSocket; w.events = []; w.states = []; w.browserSockets = [];
    // Preserve native WebSocket.close validation; replace only bufferedAmount in the backpressure test.
    w.WebSocket = class extends Native { constructor(url: string) { super(url); w.browserSockets.push(this); } };
    w.client = new w.LCYClient.RealtimeClient(settings, sessionId, 0, { onMessage: (m: unknown) => w.events.push(m), onState: (state: string) => w.states.push(state) });
    w.client.connect();
  }, { settings: { ...DEFAULT_SETTINGS, gatewayUrl: `ws://127.0.0.1:${address.port}` }, sessionId: sid });
  await expect.poll(() => page.evaluate(() => (window as any).states.includes('ready'))).toBe(true);
  return { closeCodes, sendFatal: () => peer!.send(JSON.stringify({ type: 'error', sessionId: sid, code: 'unauthorized', message: 'Invalid token', retryable: false })), cleanup: async () => { await page.close(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); await new Promise<void>(resolve => http.close(() => resolve())); } };
}
test('M1-059 原生 WebSocket 背压关闭不抛异常', async ({ page }, info) => {
  const f = await nativeClient(page);
  try {
    const result = await page.evaluate(() => {
      const w = window as any; Object.defineProperty(w.browserSockets[0], 'bufferedAmount', { get: () => 262145 });
      try { w.client.push({ sequence: 0, audioEndMs: 40, pcm: new Uint8Array(1280) }); return { error: null }; }
      catch (error) { return { error: String(error) }; }
    });
    await info.attach('native-close-result', { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.error).toBeNull();
    await expect.poll(() => f.closeCodes).toContain(4013);
  } finally { await f.cleanup(); }
});
test('M1-060 原生 WebSocket 致命错误正常关闭', async ({ page }, info) => {
  const f = await nativeClient(page);
  try {
    f.sendFatal();
    await expect.poll(() => page.evaluate(() => (window as any).events.some((m: any) => m.code === 'unauthorized'))).toBe(true);
    const events = await page.evaluate(() => (window as any).events);
    await info.attach('fatal-error-events', { body: JSON.stringify(events), contentType: 'application/json' });
    expect(events.some((m: any) => m.code === 'invalid_server_message')).toBe(false);
    await expect.poll(() => f.closeCodes).toContain(4008);
  } finally { await f.cleanup(); }
});
