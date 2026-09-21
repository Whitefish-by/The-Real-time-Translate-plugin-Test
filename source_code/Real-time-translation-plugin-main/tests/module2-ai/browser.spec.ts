import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../../packages/shared/src/index";

async function installContent(
  page: Page,
  settings: ExtensionSettings = DEFAULT_SETTINGS,
  options: { installClock?: boolean } = {},
): Promise<void> {
  await page.route("http://module2.test/**", (route) => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><meta charset=utf-8><title>模块二字幕交互测试</title><main><h1>本地字幕测试页</h1><p>不访问真实云服务。</p></main>",
  }));
  await page.goto("http://module2.test/");
  if (options.installClock) await page.clock.install();
  await page.evaluate((initialSettings) => {
    const w = window as any;
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      const root = original.call(this, init);
      w.module2Shadow = root;
      return root;
    };
    w.module2Sent = [];
    w.module2Settings = initialSettings;
    w.chrome = {
      runtime: {
        onMessage: { addListener: (callback: unknown) => { w.module2Dispatch = callback; } },
        sendMessage: async (message: { type: string; settings?: ExtensionSettings }) => {
          if (message.type === "settings:get") return initialSettings;
          if (message.type === "settings:set") {
            const value = message.settings?.verticalOffset;
            if (!Number.isInteger(value) || value! < 0 || value! > 500) throw new Error("设置校验失败");
          }
          w.module2Sent.push(message);
          return undefined;
        },
      },
    };
  }, settings);
  await page.addScriptTag({ path: resolve("apps/extension/dist/content.js") });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).module2Dispatch))).toBe(true);
  await page.evaluate((currentSettings) => (window as any).module2Dispatch({
    type: "content:subtitle",
    settings: currentSettings,
    event: {
      type: "subtitle",
      sessionId: "00000000-0000-4000-8000-000000000000",
      segmentId: "drag-target",
      revision: 0,
      sourceLanguage: "en-US",
      sourceText: "local subtitle",
      translatedText: "本地字幕",
      isFinal: false,
      audioStartMs: 0,
      audioEndMs: 500,
      generation: 0,
    },
  }), settings);
}

async function panelBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const panel = (window as any).module2Shadow.querySelector("#panel") as HTMLElement;
    const box = panel.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

async function drag(page: Page, deltaY: number): Promise<void> {
  const box = await panelBox(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY);
  await page.mouse.up();
}

async function savedOffsets(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as any).module2Sent
    .filter((message: { type: string }) => message.type === "settings:set")
    .map((message: { settings: ExtensionSettings }) => message.settings.verticalOffset));
}

test("M2-019 小数拖拽保存为整数", async ({ page }, info) => {
  await installContent(page);
  const box = await panelBox(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 0.5);
  await page.mouse.up();
  expect(await savedOffsets(page)).toEqual([42]);
  await page.screenshot({ path: info.outputPath("M2-019-after.png"), fullPage: true });
});

test("M2-020 拖拽偏移下界钳制为0", async ({ page }) => {
  await installContent(page);
  await drag(page, 1_000);
  expect(await savedOffsets(page)).toEqual([0]);
});

test("M2-021 拖拽偏移上界钳制为500", async ({ page }) => {
  await installContent(page);
  await drag(page, -1_000);
  expect(await savedOffsets(page)).toEqual([500]);
});

test("M2-022 取消拖拽清理状态且不保存", async ({ page }, info) => {
  await installContent(page);
  const box = await panelBox(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 10);
  await page.evaluate(() => {
    const panel = (window as any).module2Shadow.querySelector("#panel") as HTMLElement;
    panel.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
  });
  await page.mouse.move(x, y - 50);
  const state = await page.evaluate(() => {
    const panel = (window as any).module2Shadow.querySelector("#panel") as HTMLElement;
    return {
      dragging: panel.classList.contains("dragging"),
      captured: panel.hasPointerCapture(1),
      offset: panel.style.getPropertyValue("--offset"),
      saved: (window as any).module2Sent.filter((message: { type: string }) => message.type === "settings:set").length,
    };
  });
  expect(state).toEqual({ dragging: false, captured: false, offset: "52px", saved: 0 });
  await page.mouse.up();
  await page.screenshot({ path: info.outputPath("M2-022-after.png"), fullPage: true });
});

test("M2-023 无音频提示在恢复后清除", async ({ page }) => {
  await installContent(page);
  await page.evaluate(() => (window as any).module2Dispatch({
    type: "content:subtitle",
    settings: (window as any).module2Settings,
    event: { type: "status", code: "no_audio", message: "未检测到音频" },
  }));
  let status = await page.evaluate(() => {
    const node = (window as any).module2Shadow.querySelector("#status") as HTMLElement;
    return { text: node.textContent, className: node.className };
  });
  expect(status).toEqual({ text: "未检测到音频", className: "visible" });
  await page.waitForTimeout(100);
  await page.evaluate(() => (window as any).module2Dispatch({
    type: "content:subtitle",
    settings: (window as any).module2Settings,
    event: { type: "status", code: "audio_resumed", message: "音频已恢复" },
  }));
  status = await page.evaluate(() => {
    const node = (window as any).module2Shadow.querySelector("#status") as HTMLElement;
    return { text: node.textContent, className: node.className };
  });
  expect(status.className).toBe("");
});

test("M2-024 启动提示在2400毫秒隐藏", async ({ page }) => {
  await installContent(page, DEFAULT_SETTINGS, { installClock: true });
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now);
  await page.evaluate((settings) => (window as any).module2Dispatch({
    type: "content:subtitle",
    settings,
    event: { type: "ready", sessionId: "00000000-0000-4000-8000-000000000000", provider: "fake" },
  }), DEFAULT_SETTINGS);
  const visible = () => page.evaluate(() => (window as any).module2Shadow.querySelector("#status").className);
  expect(await visible()).toBe("visible");
  await page.clock.fastForward(2_399);
  expect(await visible()).toBe("visible");
  await page.clock.fastForward(1);
  expect(await visible()).toBe("");
});
