import { it, expect } from 'vitest';
import { DEFAULT_SETTINGS, extensionSettingsSchema, subtitleEventSchema, decodeAudioFrame, emptySubtitleState, mergeSubtitle, type SubtitleEvent } from '../../packages/shared/src/index';
const event = (patch: Partial<SubtitleEvent> = {}): SubtitleEvent => ({ type: 'subtitle', sessionId: '11111111-1111-4111-8111-111111111111', segmentId: 's1', generation: 0, revision: 1, sourceLanguage: 'en-US', sourceText: 'Hello', translatedText: '你好', isFinal: false, audioStartMs: 0, audioEndMs: 40, ...patch });
for (const [id, length, valid] of [['039', 7, false], ['040', 8, true], ['041', 512, true], ['042', 513, false]] as const) {
  it(`M1-${id} 客户端令牌长度 ${length} 个字符`, () => {
    const token = 'a'.repeat(length);
    const result = extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, clientToken: token });
    expect(result.success).toBe(valid);
    if (result.success) expect(result.data.clientToken).toBe(token);
    else expect(result.error.issues.map(i => i.path)).toContainEqual(['clientToken']);
  });
}
for (const [id, offset] of [['043', -1], ['044', 501]] as const) {
  it(`M1-${id} 字幕垂直偏移越界 ${offset} px`, () => {
    const result = extensionSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, verticalOffset: offset });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(i => i.path)).toContainEqual(['verticalOffset']);
  });
}
it('M1-045 拒绝字幕结束时间早于开始时间', () => {
  const result = subtitleEventSchema.safeParse(event({ audioStartMs: 100, audioEndMs: 99 }));
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues.map(i => i.message)).toContain('audioEndMs must not precede audioStartMs');
});
it('M1-046 解码端拒绝奇数字节 PCM 负载', () => {
  expect(() => decodeAudioFrame(new Uint8Array(9))).toThrow('PCM16 payload has an odd byte length');
});
it('M1-047 相同修订号重复事件保持幂等', () => {
  const original = mergeSubtitle(emptySubtitleState(), event());
  expect(mergeSubtitle(original, event({ sourceText: 'Changed' }))).toBe(original);
  expect(original.interim?.sourceText).toBe('Hello');
});
it('M1-048 上一片段最终结果保留下一片段临时结果', () => {
  const state = mergeSubtitle(emptySubtitleState(), event({ segmentId: 's2', sourceText: 'Next' }));
  const result = mergeSubtitle(state, event({ revision: 2, isFinal: true, sourceText: 'Done' }));
  expect(result.final).toMatchObject({ segmentId: 's1', sourceText: 'Done' });
  expect(result.interim).toMatchObject({ segmentId: 's2', sourceText: 'Next' });
});
