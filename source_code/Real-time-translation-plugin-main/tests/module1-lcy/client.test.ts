import { afterEach, it, expect, vi } from 'vitest';
import { RealtimeClient } from '../../apps/extension/src/realtime-client';
import { DEFAULT_SETTINGS, type ServerMessage } from '../../packages/shared/src/index';
const sid = '11111111-1111-4111-8111-111111111111';
const sockets: Socket[] = [];
const clients: RealtimeClient[] = [];
class Socket extends EventTarget {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: unknown[] = [];
  constructor(_url: string) { super(); sockets.push(this); }
  send(data: unknown) { this.sent.push(data); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.dispatchEvent(new Event('close')); }
  receive(message: unknown) { this.dispatchEvent(new MessageEvent('message', { data: typeof message === 'string' ? message : JSON.stringify(message) })); }
}
function fixture() {
  vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket);
  const messages: ServerMessage[] = [];
  const client = new RealtimeClient(DEFAULT_SETTINGS, sid, 0, { onMessage: m => messages.push(m), onState: () => {} });
  clients.push(client); client.connect();
  const socket = sockets.at(-1)!; socket.dispatchEvent(new Event('open'));
  socket.receive({ type: 'ready', sessionId: sid, provider: 'fake' });
  return { client, socket, messages };
}
afterEach(() => { for (const c of clients.splice(0)) c.close(); sockets.splice(0); vi.unstubAllGlobals(); vi.useRealTimers(); });
function expectFatalStops(raw: unknown, code: string) {
  const { client, socket, messages } = fixture();
  socket.receive(raw);
  client.push({ sequence: 0, audioEndMs: 40, pcm: new Uint8Array(1280) });
  expect(messages.filter(m => m.type === 'error')).toEqual([expect.objectContaining({ code, retryable: false })]);
  expect(socket.sent.filter(x => x instanceof ArrayBuffer)).toHaveLength(0);
  expect(socket.readyState).toBe(3);
  vi.advanceTimersByTime(10000);
  expect(sockets).toHaveLength(1);
}
it('M1-049 无效服务端消息终止音频发送', () => expectFatalStops('{invalid-json', 'invalid_server_message'));
it('M1-061 会话不匹配后停止发送且不重连', () => expectFatalStops({ type: 'ready', sessionId: '22222222-2222-4222-8222-222222222222', provider: 'fake' }, 'session_mismatch'));
it('M1-062 可重试错误保留断线恢复能力', () => {
  const { client, socket, messages } = fixture();
  socket.receive({ type: 'error', sessionId: sid, code: 'temporary_failure', message: '暂时不可用', retryable: true });
  expect(socket.readyState).toBe(1);
  socket.close(); vi.advanceTimersByTime(100);
  expect(sockets).toHaveLength(2);
  const replacement = sockets[1]!; replacement.dispatchEvent(new Event('open'));
  expect(JSON.parse(String(replacement.sent[0]))).toMatchObject({ generation: 1 });
  replacement.receive({ type: 'ready', sessionId: sid, provider: 'fake' });
  client.push({ sequence: 1, audioEndMs: 80, pcm: new Uint8Array(1280) });
  expect(replacement.sent.filter(x => x instanceof ArrayBuffer)).toHaveLength(1);
  expect(messages.some(m => m.type === 'error' && m.code === 'temporary_failure')).toBe(true);
});
