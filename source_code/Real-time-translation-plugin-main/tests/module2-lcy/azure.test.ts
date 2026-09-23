import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import { DEFAULT_SETTINGS, makeHello } from '../../packages/shared/src/index';
import { AzureSpeechProvider } from '../../apps/gateway/src/providers/azure';
import type { ProviderEvent, SpeechProviderSession } from '../../apps/gateway/src/providers/types';

// Preserve the installed SDK's enums; replace only objects that would access cloud services.
const h = vi.hoisted(() => ({ recognizer: null as any, stream: null as any, config: null as any, startError: '', stopError: '' }));
vi.mock('microsoft-cognitiveservices-speech-sdk', async importOriginal => {
  const real = await importOriginal<typeof import('microsoft-cognitiveservices-speech-sdk')>();
  const config = () => h.config = { setProperty: vi.fn(), addTargetLanguage: vi.fn(), enableDictation: vi.fn() };
  return { ...real,
    SpeechTranslationConfig: { fromEndpoint: vi.fn(config), fromSubscription: vi.fn(config) },
    AudioStreamFormat: { getWaveFormatPCM: vi.fn(() => 'pcm-format') },
    AudioInputStream: { createPushStream: vi.fn(() => h.stream = { write: vi.fn(), close: vi.fn() }) },
    AudioConfig: { fromStreamInput: vi.fn(() => 'audio-config') },
    AutoDetectSourceLanguageConfig: { fromLanguages: vi.fn(() => 'languages') },
    AutoDetectSourceLanguageResult: { fromResult: vi.fn((r: any) => ({ language: r.language })) },
    TranslationRecognizer: { FromConfig: vi.fn(() => h.recognizer = {
      startContinuousRecognitionAsync: vi.fn((ok: () => void, fail: (e: string) => void) => h.startError ? fail(h.startError) : ok()),
      stopContinuousRecognitionAsync: vi.fn((ok: () => void, fail: (e: string) => void) => h.stopError ? fail(h.stopError) : ok()),
      close: vi.fn()
    }) }
  };
});
const sessions: SpeechProviderSession[] = [];
beforeEach(() => { vi.clearAllMocks(); h.startError = ''; h.stopError = ''; });
afterEach(() => { sessions.splice(0).forEach(s => s.abort()); });
function setup(endpoint?: string) {
  const hello = makeHello(DEFAULT_SETTINGS, '11111111-1111-4111-8111-111111111111', 2);
  const events: ProviderEvent[] = [];
  const session = new AzureSpeechProvider({ key: 'test-key', region: 'test-region', ...(endpoint ? { endpoint } : {}) })
    .createSession(hello, e => events.push(e));
  sessions.push(session);
  return { session, hello, events };
}
const frame = (audioEndMs = 40, pcm = new Uint8Array(1280)) => ({ sequence: 0, audioEndMs, pcm });
function result(overrides: Record<string, unknown> = {}, final = false) {
  const r = { reason: final ? sdk.ResultReason.TranslatedSpeech : sdk.ResultReason.TranslatingSpeech,
    text: 'Hello', language: 'en-US', offset: 0, duration: 400000,
    translations: new Map([['zh-Hans', '你好']]), ...overrides };
  h.recognizer[final ? 'recognized' : 'recognizing'](null, { result: r });
}
function cancel(errorCode: sdk.CancellationErrorCode, reason = sdk.CancellationReason.Error) {
  h.recognizer.canceled(null, { reason, errorCode, errorDetails: 'test cancellation' });
}
it('M2-LCY-001 自定义端点传给SDK', () => {
  setup('https://example.invalid/speech');
  expect(sdk.SpeechTranslationConfig.fromEndpoint).toHaveBeenCalledWith(new URL('https://example.invalid/speech'), 'test-key');
  expect(sdk.SpeechTranslationConfig.fromSubscription).not.toHaveBeenCalled();
});
it('M2-LCY-002 无端点时使用订阅区域', () => {
  setup(); expect(sdk.SpeechTranslationConfig.fromSubscription).toHaveBeenCalledWith('test-key', 'test-region');
  expect(sdk.SpeechTranslationConfig.fromEndpoint).not.toHaveBeenCalled();
});
it('M2-LCY-003 源语言和目标语言传递正确', () => {
  const { hello } = setup();
  expect(h.config.addTargetLanguage).toHaveBeenCalledWith(hello.targetLanguage);
  expect(sdk.AutoDetectSourceLanguageConfig.fromLanguages).toHaveBeenCalledWith(hello.sourceLanguages);
  expect(h.config.setProperty).toHaveBeenCalledWith(sdk.PropertyId.SpeechServiceConnection_LanguageIdMode, 'Continuous');
});
it('M2-LCY-004 PCM格式固定为16kHz16位单声道', () => {
  setup(); expect(sdk.AudioStreamFormat.getWaveFormatPCM).toHaveBeenCalledWith(16000, 16, 1);
  expect(sdk.AudioConfig.fromStreamInput).toHaveBeenCalledWith(h.stream);
});
it('M2-LCY-005 启动成功兑现Promise', async () => {
  const { session } = setup(); await expect(session.start()).resolves.toBeUndefined();
  expect(h.recognizer.startContinuousRecognitionAsync).toHaveBeenCalledTimes(1);
});
it('M2-LCY-006 启动失败保留错误说明', async () => {
  const { session } = setup(); h.startError = 'start failed';
  await expect(session.start()).rejects.toThrow('start failed');
});
it('M2-LCY-007 PCM子数组只复制有效字节', () => {
  const { session } = setup(); const data = new Uint8Array([99, 1, 2, 88]);
  session.write(frame(40, data.subarray(1, 3))); data[1] = 7;
  expect([...new Uint8Array(h.stream.write.mock.calls[0][0])]).toEqual([1, 2]);
});
it('M2-LCY-008 abort后不再写入音频', () => {
  const { session } = setup(); session.abort(); session.write(frame()); expect(h.stream.write).not.toHaveBeenCalled();
});
it('M2-LCY-009 end后不再写入音频', async () => {
  const { session } = setup(); await session.end(); session.write(frame()); expect(h.stream.write).not.toHaveBeenCalled();
});
it('M2-LCY-010 首帧不足40毫秒时起点钳制到零', () => {
  const { session, events } = setup(); session.write(frame(39)); result();
  expect(events[0]).toMatchObject({ audioStartMs: 0, audioEndMs: 40, generation: 2 });
});
it('M2-LCY-011 SDK时间刻度在半毫秒处取整', () => {
  const { session, events } = setup(); session.write(frame(1040));
  result({ offset: 4999, duration: 5000 });
  expect(events[0]).toMatchObject({ audioStartMs: 1000, audioEndMs: 1001 });
  result({ offset: 5000, duration: 4999 });
  expect(events[1]).toMatchObject({ audioStartMs: 1001, audioEndMs: 1001 });
});
it('M2-LCY-012 NoMatch结果不输出字幕', () => {
  const { events } = setup(); result({ reason: sdk.ResultReason.NoMatch }); expect(events).toHaveLength(0);
});
it('M2-LCY-013 空原文不输出字幕', () => {
  const { events } = setup(); result({ text: '' }); expect(events).toHaveLength(0);
});
it('M2-LCY-014 语言识别为空时回退首个源语言', () => {
  const { events, hello } = setup(); result({ language: '' }); expect(events[0]).toMatchObject({ sourceLanguage: hello.sourceLanguages[0] });
});
it('M2-LCY-015 缺少目标译文时输出null', () => {
  const { events } = setup(); result({ translations: new Map() }); expect(events[0]).toMatchObject({ translatedText: null });
});
it('M2-LCY-016 同片段临时与最终结果修订号递增', () => {
  const { events } = setup(); result(); result({}, true);
  expect(events).toMatchObject([{ revision: 0, isFinal: false }, { revision: 1, isFinal: true }]);
  expect(events[0]).toMatchObject({ segmentId: 'azure-0' });
});
it('M2-LCY-017 正常结束只关闭一次资源', async () => {
  const { session } = setup(); await session.end(); await session.end(); session.abort();
  expect(h.stream.close).toHaveBeenCalledTimes(1); expect(h.recognizer.close).toHaveBeenCalledTimes(1);
  expect(h.recognizer.stopContinuousRecognitionAsync).toHaveBeenCalledTimes(1);
});
it('M2-LCY-018 停止SDK失败仍释放资源', async () => {
  const { session } = setup(); h.stopError = 'stop failed'; await expect(session.end()).resolves.toBeUndefined();
  expect(h.stream.close).toHaveBeenCalledTimes(1); expect(h.recognizer.close).toHaveBeenCalledTimes(1);
});
it('M2-LCY-019 abort重复调用保持幂等', () => {
  const { session } = setup(); session.abort(); session.abort();
  expect(h.stream.close).toHaveBeenCalledTimes(1); expect(h.recognizer.close).toHaveBeenCalledTimes(1);
  expect(h.recognizer.stopContinuousRecognitionAsync).not.toHaveBeenCalled();
});
it('M2-LCY-020 abort后迟到回调不再发出事件', () => {
  const { session, events } = setup(); session.abort(); result(); result({}, true);
  cancel(sdk.CancellationErrorCode.ConnectionFailure); h.recognizer.sessionStopped();
  expect(events).toHaveLength(0);
});
it('M2-LCY-021 认证失败不可重试', () => {
  const { events } = setup(); cancel(sdk.CancellationErrorCode.AuthenticationFailure);
  expect(events).toEqual([expect.objectContaining({ type: 'provider-error', retryable: false, message: 'test cancellation' })]);
});
it('M2-LCY-022 参数错误不可重试', () => {
  const { events } = setup(); cancel(sdk.CancellationErrorCode.BadRequestParameters);
  expect(events).toEqual([expect.objectContaining({ type: 'provider-error', retryable: false })]);
});
it('M2-LCY-023 服务超时保留重试能力', () => {
  const { events } = setup(); cancel(sdk.CancellationErrorCode.ServiceTimeout);
  expect(events).toEqual([expect.objectContaining({ type: 'provider-error', retryable: true })]);
});
it('M2-LCY-024 正常流结束不报告服务错误', () => {
  const { events } = setup(); cancel(sdk.CancellationErrorCode.NoError, sdk.CancellationReason.EndOfStream);
  expect(events.filter(e => e.type === 'provider-error')).toHaveLength(0);
});
