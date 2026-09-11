import { it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { DEFAULT_SETTINGS, makeHello, encodeAudioFrame } from '../../packages/shared/src/index';
import { createGateway } from '../../apps/gateway/src/server';
import { readConfig } from '../../apps/gateway/src/config';
const gateways: Awaited<ReturnType<typeof createGateway>>[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => { for (const s of sockets.splice(0))
    s.terminate(); await Promise.all(gateways.splice(0).map(g => g.close())); });
async function start() { const g = await createGateway(readConfig({ PORT: '0', SPEECH_PROVIDER: 'fake', GATEWAY_CLIENT_TOKEN: 'module1-secret' })); gateways.push(g); const a = g.server.address(); if (!a || typeof a === 'string')
    throw Error('No port'); return `ws://127.0.0.1:${a.port}/v1/realtime`; }
async function open() { const s = new WebSocket(await start()); sockets.push(s); await new Promise<void>((resolve, reject) => { s.once('open', resolve); s.once('error', reject); }); return s; }
function next(s: WebSocket, type: string) { return new Promise<any>((resolve, reject) => { const timer = setTimeout(() => { s.off('message', listener); reject(Error(`Timed out waiting for ${type}`)); }, 3000); const listener = (raw: WebSocket.RawData) => { const m = JSON.parse(raw.toString()); if (m.type === type) {
    clearTimeout(timer);
    s.off('message', listener);
    resolve(m);
} }; s.on('message', listener); }); }
async function hello(s: WebSocket) { const id = crypto.randomUUID(); const p = next(s, 'ready'); s.send(JSON.stringify(makeHello({ ...DEFAULT_SETTINGS, clientToken: 'module1-secret' }, id, 0))); await p; return id; }
it('M1-029 健康检查返回 fake 能力', async () => { const url = await start(); const r = await fetch(url.replace('ws:', 'http:').replace('/v1/realtime', '/healthz')); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ ok: true, provider: 'fake', protocolVersion: 1 }); });
it('M1-030 错误令牌被拒绝', async () => { const s = await open(); const p = next(s, 'error'); s.send(JSON.stringify(makeHello({ ...DEFAULT_SETTINGS, clientToken: 'wrong-token' }, crypto.randomUUID(), 0))); expect(await p).toMatchObject({ code: 'unauthorized', retryable: false }); });
it('M1-031 未握手发送音频被拒绝', async () => { const s = await open(); const p = next(s, 'error'); s.send(new Uint8Array(1288)); expect(await p).toMatchObject({ code: 'bad_message' }); });
it('M1-032 正常会话生成最终字幕并停止', async () => { const s = await open(); const id = await hello(s); const result = new Promise<any>(resolve => s.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.type === 'subtitle' && m.isFinal)
    resolve(m); })); s.send(encodeAudioFrame({ sequence: 0, audioEndMs: 800, pcm: new Uint8Array(1280) })); expect(await result).toMatchObject({ sessionId: id, isFinal: true }); const closed = new Promise<number>(resolve => s.once('close', resolve)); s.send(JSON.stringify({ type: 'end', sessionId: id })); expect(await closed).toBe(1000); });
it('M1-033 错误帧长度被拒绝', async () => { const s = await open(); await hello(s); const p = next(s, 'error'); s.send(encodeAudioFrame({ sequence: 0, audioEndMs: 40, pcm: new Uint8Array(2) })); expect(await p).toMatchObject({ code: 'bad_message' }); });
