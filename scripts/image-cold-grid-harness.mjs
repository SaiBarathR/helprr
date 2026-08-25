const itemCount = Math.max(1000, Number.parseInt(process.env.HELPRR_IMAGE_HARNESS_ITEMS ?? '1000', 10));
const windowSize = Math.max(1, Number.parseInt(process.env.HELPRR_IMAGE_HARNESS_WINDOW_SIZE ?? '24', 10));
const origin = process.env.HELPRR_IMAGE_HARNESS_ORIGIN;
const upstreamTemplate = process.env.HELPRR_IMAGE_HARNESS_UPSTREAM_TEMPLATE;
let cookie = process.env.HELPRR_IMAGE_HARNESS_COOKIE;

if (!origin || !upstreamTemplate || !upstreamTemplate.includes('{id}')) {
  throw new Error(
    'Set HELPRR_IMAGE_HARNESS_ORIGIN and HELPRR_IMAGE_HARNESS_UPSTREAM_TEMPLATE containing {id}.',
  );
}

if (!cookie) {
  const username = process.env.HELPRR_IMAGE_HARNESS_USERNAME
    ?? process.env.HELPRR_DEV_ADMIN_USERNAME
    ?? 'dev-admin';
  const password = process.env.HELPRR_IMAGE_HARNESS_PASSWORD
    ?? process.env.HELPRR_DEV_APP_PASSWORD;
  if (!password) {
    throw new Error(
      'Set HELPRR_IMAGE_HARNESS_COOKIE or provide harness/dev login credentials.',
    );
  }
  const login = await fetch(new URL('/api/auth/login', origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = login.headers.get('set-cookie');
  const sessionCookie = setCookie?.split(';', 1)[0];
  if (!login.ok || !sessionCookie) {
    throw new Error(`Harness login failed with HTTP ${login.status}.`);
  }
  cookie = sessionCookie;
}

const configuredWindows = process.env.HELPRR_IMAGE_HARNESS_WINDOWS
  ?.split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isSafeInteger(value) && value >= 0);
const windowStarts = configuredWindows?.length
  ? configuredWindows
  : [0, windowSize, windowSize * 2, Math.floor(itemCount / 2), itemCount - windowSize];
const posterSources = Array.from({ length: itemCount }, (_, id) => (
  upstreamTemplate.replaceAll('{id}', String(id))
));

function timing(response, metric) {
  const header = response.headers.get('server-timing') ?? '';
  const match = new RegExp(`(?:^|,)\\s*${metric};dur=([0-9.]+)`, 'i').exec(header);
  return match ? Number(match[1]) : 0;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const records = [];
for (const rawStart of windowStarts) {
  const start = Math.min(Math.max(0, rawStart), itemCount - 1);
  const end = Math.min(itemCount, start + windowSize);
  const windowRecords = await Promise.all(
    posterSources.slice(start, end).map(async (source, offset) => {
      const requestUrl = new URL('/api/image', origin);
      requestUrl.searchParams.set('src', source);
      requestUrl.searchParams.set('w', '360');
      const startedAt = performance.now();
      const response = await fetch(requestUrl, {
        headers: { Cookie: cookie },
      });
      await response.arrayBuffer();
      return {
        item: start + offset,
        status: response.status,
        cacheStatus: response.headers.get('x-helprr-cache') ?? 'UNKNOWN',
        totalMs: performance.now() - startedAt,
        queueMs: timing(response, 'helprr-queue'),
        upstreamMs: timing(response, 'helprr-upstream'),
      };
    }),
  );
  records.push(...windowRecords);
}

const byStatus = Object.fromEntries(
  [...new Set(records.map((record) => record.status))]
    .map((status) => [status, records.filter((record) => record.status === status).length]),
);
const byCacheStatus = Object.fromEntries(
  [...new Set(records.map((record) => record.cacheStatus))]
    .map((status) => [status, records.filter((record) => record.cacheStatus === status).length]),
);

console.log(JSON.stringify({
  itemCount,
  windowSize,
  windowStarts,
  requestedItems: records.length,
  uniqueRequestedItems: new Set(records.map((record) => record.item)).size,
  byStatus,
  byCacheStatus,
  latencyMs: {
    p50: percentile(records.map((record) => record.totalMs), 0.5),
    p95: percentile(records.map((record) => record.totalMs), 0.95),
    max: Math.max(0, ...records.map((record) => record.totalMs)),
  },
  queueMs: {
    p50: percentile(records.map((record) => record.queueMs), 0.5),
    p95: percentile(records.map((record) => record.queueMs), 0.95),
    max: Math.max(0, ...records.map((record) => record.queueMs)),
  },
  upstreamMs: {
    p50: percentile(records.map((record) => record.upstreamMs), 0.5),
    p95: percentile(records.map((record) => record.upstreamMs), 0.95),
    max: Math.max(0, ...records.map((record) => record.upstreamMs)),
  },
}, null, 2));
