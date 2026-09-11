import { it, expect, afterEach, vi } from 'vitest';
import { DEFAULT_SETTINGS, extensionSettingsSchema, encodeAudioFrame, decodeAudioFrame, mergeSubtitle, emptySubtitleState, type SubtitleEvent } from '../../packages/shared/src/index';
import { BoxDownsampler } from '../../apps/extension/src/audio/downsample';
import { RealtimeClient } from '../../apps/extension/src/realtime-client';
const sid = '00000000-0000-4000-8000-000000000000';
function event(revision: number, isFinal = false): SubtitleEvent { return { type: 'subtitle', sessionId: sid, segmentId: 's1', revision, isFinal, generation: 0, sourceLanguage: 'en-US', sourceText: `hello ${revision}`, translatedText: `你好 ${revision}`, audioStartMs: 0, audioEndMs: 500 }; }
const sockets: MockSocket[] = [];
class MockSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = 0;
    binaryType = '';
    sent: unknown[] = [];
    constructor(_url: string) { super(); sockets.push(this); }
    send(data: unknown) { this.sent.push(data); }
    close() { if (this.readyState === 3)
        return; this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
function clientFixture() { vi.stubGlobal('WebSocket', MockSocket); const messages: any[] = []; const client = new RealtimeClient(DEFAULT_SETTINGS, sid, 0, { onMessage: m => messages.push(m), onState: () => { } }); client.connect(); const socket = sockets.at(-1)!; socket.dispatchEvent(new Event('open')); return { client, socket, messages }; }
function frame(i: number) { return { sequence: i, audioEndMs: (i + 1) * 40, pcm: new Uint8Array(1280) }; }
function ready(socket: MockSocket) { socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ready', sessionId: sid, provider: 'fake' }) })); }
function binary(socket: MockSocket) { return socket.sent.filter((x): x is ArrayBuffer => x instanceof ArrayBuffer).map(decodeAudioFrame); }
afterEach(() => { sockets.splice(0); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("M1-001 字号 13 的范围校验", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, fontSizePx: 13 }).success).toBe(false);
});
it("M1-002 字号 14 的范围校验", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, fontSizePx: 14 }).success).toBe(true);
});
it("M1-003 字号 48 的范围校验", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, fontSizePx: 48 }).success).toBe(true);
});
it("M1-004 字号 49 的范围校验", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, fontSizePx: 49 }).success).toBe(false);
});
it("M1-005 源语言数量 0", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, sourceLanguages: [] }).success).toBe(false);
});
it("M1-006 源语言数量 1", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, sourceLanguages: ["en-US"] }).success).toBe(true);
});
it("M1-007 源语言数量 10", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, sourceLanguages: ["zh-CN", "en-US", "ja-JP", "ko-KR", "fr-FR", "de-DE", "es-ES", "ru-RU", "pt-BR", "ar-SA"] }).success).toBe(true);
});
it("M1-008 源语言数量 11", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, sourceLanguages: ["lang-0", "lang-1", "lang-2", "lang-3", "lang-4", "lang-5", "lang-6", "lang-7", "lang-8", "lang-9", "lang-10"] }).success).toBe(false);
});
it("M1-009 源语言数量 2 且重复", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, sourceLanguages: ["en-US", "en-US"] }).success).toBe(false);
});
it("M1-010 背景透明度 -0.01", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, backgroundOpacity: -0.01 }).success).toBe(false);
});
it("M1-011 背景透明度 0", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, backgroundOpacity: 0 }).success).toBe(true);
});
it("M1-012 背景透明度 1", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, backgroundOpacity: 1 }).success).toBe(true);
});
it("M1-013 背景透明度 1.01", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, backgroundOpacity: 1.01 }).success).toBe(false);
});
it("M1-014 拒绝 HTTP 网关地址", async () => {
    expect(extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, gatewayUrl: 'http://localhost:8787' }).success).toBe(false);
});
it("M1-015 PCM 小端编解码往返", async () => {
    const f = { sequence: 42, audioEndMs: 920, pcm: new Uint8Array([1, 2, 3, 4]) };
    const b = encodeAudioFrame(f);
    expect([...new Uint8Array(b).slice(0, 4)]).toEqual([42, 0, 0, 0]);
    expect(decodeAudioFrame(b)).toEqual(f);
});
it("M1-016 拒绝不足八字节的帧头", async () => {
    expect(() => decodeAudioFrame(new Uint8Array(7))).toThrow('shorter than its header');
});
it("M1-017 拒绝奇数字节 PCM", async () => {
    expect(() => encodeAudioFrame({ sequence: 0, audioEndMs: 40, pcm: new Uint8Array(3) })).toThrow('odd byte');
});
it("M1-018 uint32 最大序号往返", async () => {
    expect(decodeAudioFrame(encodeAudioFrame({ sequence: 0xffffffff, audioEndMs: 40, pcm: new Uint8Array(2) })).sequence).toBe(0xffffffff);
});
it("M1-019 拒绝 uint32 上界外序号", async () => {
    expect(() => encodeAudioFrame({ sequence: 0x100000000, audioEndMs: 40, pcm: new Uint8Array(2) })).toThrow('uint32');
});
it("M1-020 48kHz 分块降采样保持连续", async () => {
    const d = new BoxDownsampler(48000, 16000);
    expect(d.append(new Float32Array([1, 1]))).toEqual([]);
    expect(d.append(new Float32Array([1, 0, 0, 0]))).toEqual([1, 0]);
});
it("M1-021 拒绝源采样率低于目标", async () => {
    expect(() => new BoxDownsampler(8000, 16000)).toThrow('at least');
});
it("M1-022 旧修订不覆盖新修订", async () => {
    const s = mergeSubtitle(emptySubtitleState(), event(2));
    expect(mergeSubtitle(s, event(1))).toBe(s);
});
it("M1-023 最终字幕替换当前临时字幕", async () => {
    const s = mergeSubtitle(mergeSubtitle(emptySubtitleState(), event(1)), event(2, true));
    expect(s.final?.revision).toBe(2);
    expect(s.interim).toBeNull();
});
it("M1-024 新连接代次允许修订号重置", async () => {
    const s = mergeSubtitle(mergeSubtitle(emptySubtitleState(), event(4, true)), { ...event(0), generation: 1 });
    expect(s.interim?.generation).toBe(1);
});
it("M1-025 最终片段不能重新变为临时片段", async () => {
    const s = mergeSubtitle(mergeSubtitle(emptySubtitleState(), event(2, true)), event(3));
    expect(s.final?.revision).toBe(2);
    expect(s.interim).toBeNull();
});
it("M1-026 两秒缓存恰好容纳五十帧", async () => {
    const { client, socket, messages } = clientFixture();
    for (let i = 0; i < 50; i++)
        client.push(frame(i));
    ready(socket);
    expect(binary(socket)).toHaveLength(50);
    expect(messages.some(m => m.code === 'audio_gap')).toBe(false);
    client.close();
});
it("M1-027 第五十一帧淘汰最旧音频", async () => {
    const { client, socket, messages } = clientFixture();
    for (let i = 0; i < 51; i++)
        client.push(frame(i));
    ready(socket);
    expect(binary(socket).map(f => f.sequence)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(messages.some(m => m.code === 'audio_gap')).toBe(true);
    client.close();
});
it("M1-028 停止后取消重连计时器", async () => {
    vi.useFakeTimers();
    const { client, socket } = clientFixture();
    socket.close();
    client.close();
    vi.advanceTimersByTime(10000);
    expect(sockets).toHaveLength(1);
});
