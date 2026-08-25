import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const sharp = require('sharp');

function median(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function runWorker() {
  const sharpConcurrency = Number.parseInt(process.env.HELPRR_SHARP_CONCURRENCY ?? '1', 10);
  sharp.concurrency(sharpConcurrency);
  const width = 1_200;
  const height = 1_800;
  const pixels = Buffer.alloc(width * height * 3);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (index * 31 + Math.floor(index / 97) * 17) % 256;
  }
  const source = await sharp(pixels, {
    raw: { width, height, channels: 3 },
  }).jpeg({ quality: 90 }).toBuffer();
  const samplesMs = [];
  for (let sample = 0; sample < 3; sample += 1) {
    const startedAt = performance.now();
    await Promise.all(Array.from({ length: 16 }, () => (
      sharp(source).resize({ width: 360, withoutEnlargement: true }).webp().toBuffer()
    )));
    samplesMs.push(Math.round(performance.now() - startedAt));
  }
  console.log(JSON.stringify({
    uvThreadpoolSize: Number(process.env.UV_THREADPOOL_SIZE),
    sharpConcurrency: sharp.concurrency(),
    inputBytes: source.byteLength,
    batches: 3,
    transformsPerBatch: 16,
    samplesMs,
    medianMs: median(samplesMs),
  }));
}

function readControl(pathname) {
  try {
    return readFileSync(pathname, 'utf8').trim();
  } catch {
    return null;
  }
}

if (process.env.HELPRR_IMAGE_RUNTIME_WORKER === '1') {
  await runWorker();
} else {
  const defaultSharpConcurrency = sharp.concurrency();
  const scenarios = [
    { uvThreadpoolSize: 4, sharpConcurrency: defaultSharpConcurrency },
    { uvThreadpoolSize: 16, sharpConcurrency: defaultSharpConcurrency },
    { uvThreadpoolSize: 8, sharpConcurrency: 2 },
  ];
  const benchmarks = scenarios.map((scenario) => {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HELPRR_IMAGE_RUNTIME_WORKER: '1',
        HELPRR_SHARP_CONCURRENCY: String(scenario.sharpConcurrency),
        UV_THREADPOOL_SIZE: String(scenario.uvThreadpoolSize),
      },
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(result.stderr.trim() || `Runtime measurement failed with ${result.status}`);
    }
    return JSON.parse(result.stdout);
  });
  console.log(JSON.stringify({
    node: process.version,
    availableParallelism: os.availableParallelism(),
    uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE ?? 'default (4)',
    sharpConcurrency: defaultSharpConcurrency,
    sharpSimd: sharp.simd(),
    cgroup: {
      cpuMax: readControl('/sys/fs/cgroup/cpu.max'),
      memoryMax: readControl('/sys/fs/cgroup/memory.max'),
    },
    benchmarks,
  }, null, 2));
}
