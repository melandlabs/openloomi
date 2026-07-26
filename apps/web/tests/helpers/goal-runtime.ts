import type {
  RuntimeClockPort,
  RuntimeIdGeneratorPort,
} from "@openloomi/ai/agent/runtime-instructions";

export class FixedRuntimeClock implements RuntimeClockPort {
  constructor(private readonly instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }
}

export class DeterministicRuntimeIds implements RuntimeIdGeneratorPort {
  private nextId = 1;

  constructor(private readonly prefix = "00000000") {}

  generate(): string {
    const suffix = String(this.nextId++).padStart(12, "0");
    return `${this.prefix}-0000-4000-8000-${suffix}`;
  }
}
