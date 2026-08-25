import { execFileSync, spawnSync } from 'child_process';

const container = `helprr-image-cache-test-${process.pid}`;

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

try {
  docker(
    'run',
    '--rm',
    '-d',
    '--name', container,
    '-p', '127.0.0.1::6379',
    'redis:7-alpine',
  );
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if (docker('exec', container, 'redis-cli', 'ping') === 'PONG') {
        ready = true;
        break;
      }
    } catch {
      // Container startup is still in progress.
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (!ready) throw new Error('Disposable Redis did not become ready');
  const mapping = docker('port', container, '6379/tcp');
  const port = mapping.slice(mapping.lastIndexOf(':') + 1);
  if (!/^[0-9]+$/.test(port)) throw new Error('Could not resolve disposable Redis port');

  const result = spawnSync(
    process.platform === 'win32' ? 'node_modules/.bin/vitest.cmd' : 'node_modules/.bin/vitest',
    ['run', 'src/lib/__tests__/image-cache-redis.integration.test.ts'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        IMAGE_CACHE_TEST_REDIS_URL: `redis://127.0.0.1:${port}`,
        IMAGE_FETCH_RATE_BURST: '5',
        IMAGE_FETCH_RATE_REFILL_PER_MINUTE: '1',
        CACHE_LOCK_TTL_MS: '50',
      },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  try {
    docker('rm', '-f', container);
  } catch {
    // --rm may already have removed it.
  }
}
