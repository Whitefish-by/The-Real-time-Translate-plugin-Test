import type { SubtitleEvent } from "./protocol";

export type SubtitleState = {
  final: SubtitleEvent | null;
  interim: SubtitleEvent | null;
  revisions: Record<string, number>;
};

export const emptySubtitleState = (): SubtitleState => ({
  final: null,
  interim: null,
  revisions: {},
});

const MAX_TRACKED_REVISIONS = 128;

function withBoundedRevision(revisions: Record<string, number>, key: string, revision: number): Record<string, number> {
  const next = { ...revisions, [key]: revision };
  const keys = Object.keys(next);
  for (let index = 0; index < keys.length - MAX_TRACKED_REVISIONS; index += 1) {
    const staleKey = keys[index];
    if (staleKey !== undefined) delete next[staleKey];
  }
  return next;
}

export function mergeSubtitle(state: SubtitleState, event: SubtitleEvent): SubtitleState {
  const eventKey = `${event.generation}:${event.segmentId}`;
  const priorRevision = state.revisions[eventKey] ?? -1;
  if (event.revision <= priorRevision) return state;

  const revisions = withBoundedRevision(state.revisions, eventKey, event.revision);
  if (event.isFinal) {
    const replacesInterim = state.interim?.segmentId === event.segmentId && state.interim.generation === event.generation;
    return { final: event, interim: replacesInterim ? null : state.interim, revisions };
  }
  return { ...state, interim: event, revisions };
}

function baseLanguage(tag: string): string {
  return tag.toLowerCase().split("-")[0] ?? tag.toLowerCase();
}

export function shouldShowTranslation(sourceLanguage: string, targetLanguage: string): boolean {
  return baseLanguage(sourceLanguage) !== baseLanguage(targetLanguage);
}
