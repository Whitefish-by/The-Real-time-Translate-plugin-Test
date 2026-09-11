declare const sampleRate: number;
declare function registerProcessor(name: string, processorCtor: typeof AudioWorkletProcessor): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][]): boolean;
}

import { BoxDownsampler } from "../audio/downsample";

const TARGET_SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = 640;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly downsampler = new BoxDownsampler(sampleRate, TARGET_SAMPLE_RATE);
  private pending: number[] = [];

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const first = channels?.[0];
    if (!channels?.length || !first?.length) return true;

    const mono = new Float32Array(first.length);
    for (let index = 0; index < first.length; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] ?? 0;
      mono[index] = sample / channels.length;
    }
    this.pending.push(...this.downsampler.append(mono));

    while (this.pending.length >= FRAME_SAMPLES) {
      const pcm = new Int16Array(FRAME_SAMPLES);
      for (let index = 0; index < FRAME_SAMPLES; index += 1) {
        const value = Math.max(-1, Math.min(1, this.pending[index] ?? 0));
        pcm[index] = value < 0 ? Math.round(value * 32_768) : Math.round(value * 32_767);
      }
      this.pending.splice(0, FRAME_SAMPLES);
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
