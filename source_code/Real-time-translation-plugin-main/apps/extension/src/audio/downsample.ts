export class BoxDownsampler {
  private readonly ratio: number;
  private remainingSourceSamples: number;
  private accumulated = 0;
  private accumulatedWeight = 0;

  constructor(sourceSampleRate: number, private readonly targetSampleRate: number) {
    if (!(sourceSampleRate > 0) || !(targetSampleRate > 0) || sourceSampleRate < targetSampleRate) {
      throw new Error("The source sample rate must be at least the target sample rate");
    }
    this.ratio = sourceSampleRate / targetSampleRate;
    this.remainingSourceSamples = this.ratio;
  }

  append(samples: Float32Array): number[] {
    const output: number[] = [];
    for (const sample of samples) {
      let availableWeight = 1;
      while (availableWeight > 1e-9) {
        const consumedWeight = Math.min(availableWeight, this.remainingSourceSamples);
        this.accumulated += sample * consumedWeight;
        this.accumulatedWeight += consumedWeight;
        this.remainingSourceSamples -= consumedWeight;
        availableWeight -= consumedWeight;

        if (this.remainingSourceSamples <= 1e-9) {
          output.push(this.accumulatedWeight ? this.accumulated / this.accumulatedWeight : 0);
          this.remainingSourceSamples = this.ratio;
          this.accumulated = 0;
          this.accumulatedWeight = 0;
        }
      }
    }
    return output;
  }

  get outputSampleRate(): number {
    return this.targetSampleRate;
  }
}
