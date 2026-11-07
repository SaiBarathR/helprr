// In-memory stand-in for the slice of the Redis client the Tonight pick uses:
// hashes and counters with millisecond expiry read from Date.now(), so tests
// drive TTLs with vi.setSystemTime.

type Entry = { value: Map<string, string> | number; expiresAt: number | null };

export class FakeHashRedis {
  store = new Map<string, Entry>();

  private live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  private hash(key: string): Map<string, string> {
    const entry = this.live(key);
    if (entry && entry.value instanceof Map) return entry.value;
    const value = new Map<string, string>();
    this.store.set(key, { value, expiresAt: null });
    return value;
  }

  /** Remaining ms to live; -1 without expiry; -2 missing (like PTTL). */
  pTTL(key: string): number {
    const entry = this.live(key);
    if (!entry) return -2;
    return entry.expiresAt === null ? -1 : entry.expiresAt - Date.now();
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const entry = this.live(key);
    return entry && entry.value instanceof Map ? Object.fromEntries(entry.value) : {};
  }

  async pExpireAt(key: string, at: number): Promise<number> {
    const [result] = await this.multi().pExpireAt(key, at).exec();
    return result as number;
  }

  multi() {
    const ops: (() => unknown)[] = [];
    const chain = {
      hSet: (key: string, fieldOrValues: string | Record<string, string>, value?: string) => {
        ops.push(() => {
          const h = this.hash(key);
          if (typeof fieldOrValues === 'string') h.set(fieldOrValues, value!);
          else for (const [f, v] of Object.entries(fieldOrValues)) h.set(f, v);
          return 1;
        });
        return chain;
      },
      hSetNX: (key: string, field: string, value: string) => {
        ops.push(() => {
          const h = this.hash(key);
          if (h.has(field)) return 0;
          h.set(field, value);
          return 1;
        });
        return chain;
      },
      pExpireAt: (key: string, at: number) => {
        ops.push(() => {
          const entry = this.live(key);
          if (!entry) return 0;
          if (at <= Date.now()) this.store.delete(key);
          else entry.expiresAt = at;
          return 1;
        });
        return chain;
      },
      set: (key: string, value: string, options: { EX?: number; NX?: boolean } = {}) => {
        ops.push(() => {
          if (options.NX && this.live(key)) return null;
          this.store.set(key, { value: Number(value), expiresAt: options.EX ? Date.now() + options.EX * 1000 : null });
          return 'OK';
        });
        return chain;
      },
      incr: (key: string) => {
        ops.push(() => {
          const entry = this.live(key);
          const next = (typeof entry?.value === 'number' ? entry.value : 0) + 1;
          this.store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
          return next;
        });
        return chain;
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => {
          const entry = this.live(key);
          if (!entry) return 0;
          entry.expiresAt = Date.now() + seconds * 1000;
          return 1;
        });
        return chain;
      },
      exec: async () => ops.map((op) => op()),
    };
    return chain;
  }
}
