import { test, expect, chromium, type BrowserContext, type Worker } from "@playwright/test";
import { resolve } from "node:path";

let context: BrowserContext;
let extensionId: string;
let worker: Worker;

test.beforeAll(async () => {
  const extensionPath = resolve(import.meta.dirname, "../dist");
  context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent("serviceworker");
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
});

test("loads the MV3 extension and persists validated settings", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByRole("heading", { name: "实时双语字幕设置" })).toBeVisible();
  for (const checkbox of await page.locator('input[name="sourceLanguage"]').all()) {
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  await page.locator('input[name="sourceLanguage"][value="en-US"]').check();
  await page.locator("#font").fill("30");
  await page.locator("#url").fill("ws://127.0.0.1:18787/v1/realtime");
  await page.locator("#token").fill("playwright-secret");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.locator("#message")).toHaveText("连接成功");
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.locator("#message")).toHaveText("设置已保存");
  await page.reload();
  await expect(page.locator('input[name="sourceLanguage"]:checked')).toHaveCount(1);
  await expect(page.locator('input[name="sourceLanguage"][value="en-US"]')).toBeChecked();
  await expect(page.locator("#font")).toHaveValue("30");
  await expect(page.locator("#token")).toHaveValue("playwright-secret");
});

test("surfaces gateway authentication errors without starting a provider session", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.locator("#token").fill("wrong-secret");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.locator("#message")).toContainText("客户端令牌无效");
  await expect(page.locator("#message")).toHaveClass("error");
});

test("captures real tab audio through offscreen and stops without leaving a capture", async () => {
  test.skip(true, "CDP cannot invoke Chrome's browser action and therefore cannot grant the activeTab capture gesture");
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.locator("#url").fill("ws://127.0.0.1:18787/v1/realtime");
  await options.locator("#token").fill("playwright-secret");
  await options.getByRole("button", { name: "保存设置" }).click();
  await expect(options.locator("#message")).toHaveText("设置已保存");

  const page = await context.newPage();
  await page.route("http://playwright.test/**", (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><meta charset="utf-8"><button id="play">play audio</button><script>
      document.querySelector('#play').addEventListener('click', async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0.08;
        oscillator.frequency.value = 440;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        await context.resume();
        window.audioContextForTest = context;
      });
    </script>`,
  }));
  await page.goto("http://playwright.test/audio");
  await page.locator("#play").click();
  await expect.poll(() => page.evaluate(() => (window as Window & { audioContextForTest?: AudioContext }).audioContextForTest?.state)).toBe("running");

  const audioTabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: "http://playwright.test/*" }))[0]?.id);
  expect(audioTabId).toBeDefined();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(async (tabId) => { await chrome.tabs.update(tabId, { active: true }); }, audioTabId!);
  await popup.getByRole("button", { name: "开始生成字幕" }).click();
  await page.waitForTimeout(750);
  const initialCaptureState = await (context.serviceWorkers()[0] ?? worker).evaluate(async () => {
    const stored = await chrome.storage.session.get("activeChromeSession");
    return stored.activeChromeSession?.snapshot as { state?: string; statusMessage?: string; errorCode?: string } | undefined;
  });
  if (initialCaptureState?.state === "error") throw new Error(`Capture failed: ${JSON.stringify(initialCaptureState)}`);
  await expect.poll(async () => {
    const currentWorker = context.serviceWorkers()[0] ?? worker;
    return currentWorker.evaluate(async () => {
      const stored = await chrome.storage.session.get("activeChromeSession");
      return stored.activeChromeSession?.snapshot as { state?: string; statusMessage?: string; errorCode?: string } | undefined;
    });
  }, { timeout: 10_000 }).toMatchObject({ state: "capturing" });
  await expect.poll(async () => {
    const currentWorker = context.serviceWorkers()[0] ?? worker;
    return currentWorker.evaluate(async () => {
      const stored = await chrome.storage.session.get("activeChromeSession");
      return stored.activeChromeSession?.snapshot?.detectedLanguage as string | undefined;
    });
  }, { timeout: 10_000 }).toMatch(/^(zh-CN|en-US)$/);
  await expect.poll(() => page.evaluate(() => (window as Window & { audioContextForTest?: AudioContext }).audioContextForTest?.state)).toBe("running");

  await popup.getByRole("button", { name: "停止字幕" }).click();
  await expect.poll(async () => {
    const currentWorker = context.serviceWorkers()[0] ?? worker;
    return currentWorker.evaluate(async () => (await chrome.tabCapture.getCapturedTabs()).length);
  }, { timeout: 10_000 }).toBe(0);
});

test("rejects restricted browser pages before requesting tab audio", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole("button", { name: "开始生成字幕" }).click();
  await expect(page.locator("#error")).toContainText("请在普通 HTTP/HTTPS 网页上启动字幕");
});
