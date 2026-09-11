export function mapProviderAudioRange(
  timelineOriginMs: number,
  providerOffsetMs: number,
  providerDurationMs: number,
): { audioStartMs: number; audioEndMs: number } {
  const audioStartMs = Math.max(0, Math.round(timelineOriginMs + providerOffsetMs));
  return {
    audioStartMs,
    audioEndMs: Math.max(audioStartMs, Math.round(audioStartMs + providerDurationMs)),
  };
}
