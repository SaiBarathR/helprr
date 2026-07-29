import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetLoggerForTests,
  configureLogger,
  flushPendingWrites,
  getLoggerMetrics,
  searchLogs,
  writeLog,
} from '@/lib/logger';

let logDir: string;

beforeAll(async () => {
  logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'helprr-logger-'));
  process.env.LOG_DIR = logDir;
});

beforeEach(() => {
  configureLogger({
    enabled: true,
    level: 'debug',
    maxFileMb: 25,
    retentionDays: 30,
    timeZone: 'UTC',
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await __resetLoggerForTests();
  await fs.promises.rm(logDir, { recursive: true, force: true });
  await fs.promises.mkdir(logDir, { recursive: true });
});

afterAll(async () => {
  delete process.env.LOG_DIR;
  await fs.promises.rm(logDir, { recursive: true, force: true });
});

async function readCurrentLines(): Promise<Array<Record<string, unknown>>> {
  const text = await fs.promises.readFile(path.join(logDir, 'helprr.jsonl'), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('batched logger persistence', () => {
  it('writes an ordered partial batch with one append during an explicit drain', async () => {
    const append = vi.spyOn(fs.promises, 'appendFile');

    for (let index = 0; index < 20; index += 1) {
      writeLog('info', `entry-${index}`);
    }
    expect(append).not.toHaveBeenCalled();

    await flushPendingWrites();

    expect(append).toHaveBeenCalledTimes(1);
    const lines = await readCurrentLines();
    expect(lines.map((line) => line.message)).toEqual(
      Array.from({ length: 20 }, (_, index) => `entry-${index}`),
    );
    expect(getLoggerMetrics()).toMatchObject({
      queueDepth: 0,
      pendingBytes: 0,
      flushCount: 1,
      writeFailures: 0,
      droppedEntries: 0,
    });
  });

  it('flushes a partial batch when the short timer expires', async () => {
    vi.useFakeTimers();
    writeLog('info', 'timer entry');

    await vi.advanceTimersByTimeAsync(100);
    await flushPendingWrites();

    expect((await readCurrentLines()).map((line) => line.message)).toEqual(['timer entry']);
  });

  it('flushes immediately at the entry threshold', async () => {
    const append = vi.spyOn(fs.promises, 'appendFile');
    for (let index = 0; index < 100; index += 1) {
      writeLog('info', `threshold-${index}`);
    }

    await flushPendingWrites();

    expect(append).toHaveBeenCalledTimes(1);
    expect((await readCurrentLines()).length).toBe(100);
  });

  it('rotates before a batch would cross the configured file limit', async () => {
    configureLogger({ maxFileMb: 1 });
    await fs.promises.writeFile(
      path.join(logDir, 'helprr.jsonl'),
      Buffer.alloc(1024 * 1024 - 256),
    );

    writeLog('info', 'x'.repeat(1_000));
    await flushPendingWrites();

    const files = await fs.promises.readdir(logDir);
    expect(files.some((file) => /^helprr-.+\.jsonl$/.test(file))).toBe(true);
    expect((await readCurrentLines())[0]?.message).toBe('x'.repeat(1_000));
  });

  it('runs retention at startup instead of once per entry', async () => {
    configureLogger({ retentionDays: 1 });
    const oldFile = path.join(logDir, 'helprr-2020-01-01T00-00-00-000Z.jsonl');
    await fs.promises.writeFile(oldFile, '{}\n');
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await fs.promises.utimes(oldFile, oldDate, oldDate);
    const readdir = vi.spyOn(fs.promises, 'readdir');

    writeLog('info', 'one');
    writeLog('info', 'two');
    await flushPendingWrites();

    expect(readdir).toHaveBeenCalledTimes(1);
    await vi.waitFor(async () => {
      await expect(fs.promises.stat(oldFile)).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  it('coalesces retention while sustained logging rotates multiple files', async () => {
    configureLogger({ maxFileMb: 1 });
    let releaseCleanup = () => {};
    const cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const readdir = vi.spyOn(fs.promises, 'readdir').mockImplementationOnce(async () => {
      await cleanupGate;
      return [];
    });

    try {
      const message = 'x'.repeat(8_000);
      for (let index = 0; index < 300; index += 1) {
        writeLog('info', message);
      }
      await flushPendingWrites();

      expect(readdir).toHaveBeenCalledTimes(1);
      const files = await fs.promises.readdir(logDir);
      expect(files.filter((file) => file.startsWith('helprr-')).length).toBeGreaterThanOrEqual(2);
    } finally {
      releaseCleanup();
    }
  });

  it('redacts secrets before entries enter the batch', async () => {
    writeLog(
      'error',
      'Bearer secret-token',
      {
        apiKey: 'api-secret',
        nested: { password: 'password-secret' },
        url: 'https://example.test/?token=query-secret',
      },
    );
    await flushPendingWrites();

    const text = await fs.promises.readFile(path.join(logDir, 'helprr.jsonl'), 'utf8');
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('api-secret');
    expect(text).not.toContain('password-secret');
    expect(text).not.toContain('query-secret');
    expect(text).toContain('[REDACTED]');
  });

  it('recovers on the next batch after a write failure', async () => {
    vi.spyOn(fs.promises, 'appendFile').mockRejectedValueOnce(new Error('disk unavailable'));

    writeLog('info', 'lost entry');
    await flushPendingWrites();
    expect(getLoggerMetrics().writeFailures).toBe(1);

    writeLog('info', 'recovered entry');
    await flushPendingWrites();

    expect((await readCurrentLines()).map((line) => line.message)).toEqual(['recovered entry']);
    expect(getLoggerMetrics()).toMatchObject({ writeFailures: 1, flushCount: 1 });
  });

  it('bounds queued memory and reports entries rejected under sustained backpressure', async () => {
    const message = 'x'.repeat(8_000);
    for (let index = 0; index < 1_100; index += 1) {
      writeLog('info', message);
    }

    const saturated = getLoggerMetrics();
    expect(saturated.pendingBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(saturated.droppedEntries).toBeGreaterThan(0);
    expect(saturated.queueDepth).toBeLessThan(1_100);

    await flushPendingWrites();
    expect(getLoggerMetrics()).toMatchObject({ queueDepth: 0, pendingBytes: 0 });
  });

  it('drains pending entries before a log search', async () => {
    writeLog('warn', 'searchable pending entry');

    const entries = await searchLogs({ q: 'searchable pending', limit: 10 });

    expect(entries.map((entry) => entry.message)).toContain('searchable pending entry');
  });
});
