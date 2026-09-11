import { describe, expect, it } from "vitest";
import { percentile } from "./latency";

describe("latency percentiles", () => {
  it("returns nearest-rank p50 and p95 without retaining transcript data", () => {
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000, 1_100, 1_200, 1_300, 1_400, 1_500, 1_600, 1_700, 1_800, 1_900, 2_000];
    expect(percentile(values, 0.5)).toBe(1_000);
    expect(percentile(values, 0.95)).toBe(1_900);
    expect(percentile([], 0.5)).toBeNull();
  });
});
