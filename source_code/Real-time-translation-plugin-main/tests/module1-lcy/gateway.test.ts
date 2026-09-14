import { it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { DEFAULT_SETTINGS, makeHello, type ServerMessage } from '../../packages/shared/src/index';
import { createGateway } from '../../apps/gateway/src/server';
import { readConfig } from '../../apps/gateway/src/config';
const gateways: Awaited<ReturnType<typeof createGateway>>[] = [];
const sockets: WebSocket[] = [];
const sid = '11111111-1111-4111-8111-111111111111';
afterEach(async () => { sockets.splice(0).forEach(s => s.terminate()); await Promise.all(gateways.splice(0).map(g => g.close())); });
async function open() {
  const g = await createGateway(readConfig({ PORT: '0', SPEECH_PROVIDER: 'fake', GATEWAY_CLIENT_TOKEN: 'case-token-2026' })); gateways.push(g);
  const address = g.server.address(); if (!address || typeof address === 'string') throw Error('No listening port');
  const s = new WebSocket(`ws://127.0.0.1:${address.port}/v1/realtime`); sockets.push(s);
  const messages: ServerMessage[] = []; s.on('message', raw => messages.push(JSON.parse(raw.toString())));
  const closed = new Promise<{ code: number; reason: string }>(resolve => s.once('close', (code, reason) => resolve({ code, reason: reason.toString() })));
  await new Promise<void>((resolve, reject) => { s.once('open', resolve); s.once('error', reject); });
  return { s, messages, closed };
}
const hello = () => makeHello({ ...DEFAULT_SETTINGS, clientToken: 'case-token-2026' }, sid, 1);
it('M1-050 五秒内未握手触发超时关闭', async () => {
  const { s, messages, closed } = await open(); const start = Date.now();
  await new Promise(r => setTimeout(r, 4000)); expect(s.readyState).toBe(WebSocket.OPEN); expect(messages).toHaveLength(0);
  expect(await closed).toEqual({ code: 1008, reason: 'hello_timeout' });
  expect(Date.now() - start).toBeGreaterThanOrEqual(4800);
  expect(Date.now() - start).toBeLessThan(7000);
  expect(messages).toContainEqual(expect.objectContaining({ code: 'hello_timeout', retryable: false }));
});
it('M1-051 非法 JSON 握手被拒绝', async () => {
  const { s, messages, closed } = await open(); s.send('{broken');
  expect(await closed).toEqual({ code: 1003, reason: 'bad_message' });
  expect(messages).toContainEqual(expect.objectContaining({ code: 'bad_message', retryable: false }));
  expect(messages.some(m => m.type === 'ready')).toBe(false);
});
it('M1-052 拒绝 end 中不匹配的会话标识', async () => {
  const { s, messages, closed } = await open(); s.send(JSON.stringify(hello()));
  await expect.poll(() => messages.some(m => m.type === 'ready')).toBe(true);
  s.send(JSON.stringify({ type: 'end', sessionId: '22222222-2222-4222-8222-222222222222' }));
  expect(await closed).toEqual({ code: 1003, reason: 'bad_message' });
  expect(messages).toContainEqual(expect.objectContaining({ code: 'bad_message', message: 'end message sessionId does not match hello', retryable: false }));
});
it('M1-053 拒绝不支持的握手协议版本', async () => {
  const { s, messages, closed } = await open(); s.send(JSON.stringify({ ...hello(), protocolVersion: 2 }));
  expect(await closed).toEqual({ code: 1003, reason: 'bad_message' });
  expect(messages).toContainEqual(expect.objectContaining({ code: 'bad_message', retryable: false }));
  expect(messages.some(m => m.type === 'ready')).toBe(false);
});
