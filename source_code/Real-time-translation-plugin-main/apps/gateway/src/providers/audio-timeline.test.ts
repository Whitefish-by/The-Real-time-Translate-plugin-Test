import { describe, expect, it } from "vitest";
import { mapProviderAudioRange } from "./audio-timeline";

describe("provider audio timeline", () => {
  it("keeps Azure-relative offsets on the client session timeline after reconnect", () => {
    expect(mapProviderAudioRange(50_000, 240, 760)).toEqual({ audioStartMs: 50_240, audioEndMs: 51_000 });
  });
});
