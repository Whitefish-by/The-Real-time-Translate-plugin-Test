import { describe, expect, it } from "vitest";
import { BoxDownsampler } from "./downsample";

describe("BoxDownsampler", () => {
  it("converts 48 kHz input to exact 16 kHz sample counts across blocks", () => {
    const downsampler = new BoxDownsampler(48_000, 16_000);
    const output = [
      ...downsampler.append(new Float32Array(128).fill(0.25)),
      ...downsampler.append(new Float32Array(128).fill(0.25)),
      ...downsampler.append(new Float32Array(128).fill(0.25)),
    ];
    expect(output).toHaveLength(128);
    expect(output.every((sample) => Math.abs(sample - 0.25) < 1e-6)).toBe(true);
  });

  it("averages source samples instead of alias-prone nearest-neighbor picking", () => {
    const downsampler = new BoxDownsampler(48_000, 16_000);
    expect(downsampler.append(new Float32Array([1, 0, -1]))).toEqual([0]);
  });
});
