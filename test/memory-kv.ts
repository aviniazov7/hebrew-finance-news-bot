import type { KvStore } from "../src/dedupe.ts";

export class MemoryKv implements KvStore {
  readonly values = new Map<string, string>();
  writes = 0;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.writes += 1;
    this.values.set(key, value);
  }
}
