import type { QueryClient } from '@tanstack/react-query';

export async function refreshAfterReconnect(client: QueryClient, pathname: string, signal: AbortSignal): Promise<void> {
  const route = pathname.split('/')[1];
  const foreground = ({ movies: 'radarr', series: 'sonarr', music: 'lidarr', torrents: 'torrents', jellyfin: 'jellyfin', anime: 'anime' } as Record<string, string>)[route] ?? route;
  const queries = client.getQueryCache().findAll({ type: 'active', stale: true });
  queries.sort((a, b) => Number(b.queryKey[0] === foreground || b.queryKey[0] === 'me') - Number(a.queryKey[0] === foreground || a.queryKey[0] === 'me'));
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, queries.length) }, async () => {
    while (cursor < queries.length && !signal.aborted) {
      const query = queries[cursor++];
      await client.refetchQueries({ queryKey: query.queryKey, exact: true, type: 'active' }, { cancelRefetch: false });
      if (cursor < queries.length && !signal.aborted) await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, 150);
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }));
}
