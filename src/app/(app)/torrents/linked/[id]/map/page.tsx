'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCan } from '@/components/permission-provider';
import { ApiError, jsonFetcher, withInstanceQuery } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { formatBytes } from '@/lib/format';
import { appName, type ManualDownloadView } from '@/components/torrents/manual-download-status';
import type { SonarrEpisode } from '@/types';

type MappedFile = NonNullable<ManualDownloadView['files']>[number];
interface Decision { include: boolean; episodeIds: number[] }

const episodeLabel = (episode: { seasonNumber: number; episodeNumber: number }) =>
  `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** What the user decided before, or what Arr read when it read it as this title. */
function initialDecisions(download: ManualDownloadView, files: MappedFile[]): Record<string, Decision> {
  const forTarget = (file: MappedFile) => (download.service === 'RADARR' ? file.arr!.movie?.id : file.arr!.series?.id) === download.arrItemId;
  // Suggested only when Arr reads it as this title and has no objection; anything else is the user's call.
  const clean = (file: MappedFile) => forTarget(file) && file.arr!.rejections.length === 0;
  // A movie takes one file: one is suggested only when it is the only clean reading, never picked from several.
  const movieOpen = download.service !== 'RADARR'
    || (files.filter((file) => file.decision === 'PENDING' && clean(file)).length === 1 && !files.some((file) => file.decision === 'IMPORT'));
  const decisions: Record<string, Decision> = {};
  for (const file of files) {
    decisions[file.id] = file.decision !== 'PENDING'
      ? { include: file.decision === 'IMPORT', episodeIds: file.episodeIds }
      : { include: clean(file) && movieOpen, episodeIds: forTarget(file) ? file.arr!.episodes.map((episode) => episode.id) : [] };
  }
  return decisions;
}

/**
 * Map a fallback download's files: for each video Arr read, import it (and,
 * for a series, as which episodes) or leave it. Arr's own reading and
 * objections are shown. Import is offered once Arr has checked exactly the
 * mapping on screen, and importing past its objections needs a confirmation.
 */
export default function MapFilesPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = useCan('activity.manage');
  const [decisions, setDecisions] = useState<Record<string, Decision> | null>(null);
  const [preview, setPreview] = useState<{ key: string; rejections: Record<string, string[]> } | null>(null);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.manualDownload(id),
    queryFn: jsonFetcher<{ download: ManualDownloadView }>(`/api/manual-downloads/${id}`),
  });
  const download = query.data?.download;
  const files = useMemo(() => (download?.files ?? []).filter((file) => file.selected && file.arr), [download]);
  const extras = (download?.files ?? []).filter((file) => file.selected && file.scanned && !file.arr);
  const isSeries = download?.service === 'SONARR';
  const episodesQuery = useQuery({
    queryKey: queryKeys.episodes(download?.arrItemId ?? 0, download?.instanceId ?? undefined),
    queryFn: jsonFetcher<SonarrEpisode[]>(withInstanceQuery(`/api/sonarr/${download?.arrItemId}/episodes`, download?.instanceId ?? undefined)),
    enabled: isSeries && Boolean(download?.arrItemId),
  });
  const episodes = useMemo(() => (Array.isArray(episodesQuery.data) ? episodesQuery.data : []), [episodesQuery.data]);
  const seasons = useMemo(() => {
    const grouped = new Map<number, SonarrEpisode[]>();
    for (const episode of episodes) grouped.set(episode.seasonNumber, [...(grouped.get(episode.seasonNumber) ?? []), episode]);
    return [...grouped.entries()].sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
  }, [episodes]);

  // Start from the saved or suggested decisions once the files are here (adjusted during render).
  if (download && decisions === null && files.length > 0) setDecisions(initialDecisions(download, files));
  const current = decisions ?? {};
  const body = { files: files.map((file) => ({ fileId: file.id, decision: current[file.id]?.include ? 'IMPORT' : 'IGNORE', episodeIds: current[file.id]?.include ? current[file.id].episodeIds : [] })) };
  const key = JSON.stringify(body);
  const verdict = preview?.key === key ? preview.rejections : null;
  const objectionsOf = (file: MappedFile) => verdict?.[file.id] ?? file.arr!.rejections;
  const included = files.filter((file) => current[file.id]?.include);
  const missingEpisodes = isSeries && included.some((file) => current[file.id].episodeIds.length === 0);
  // Arr's objections to this exact mapping (an earlier reading may not have seen, say, a better file already there).
  const objections = verdict ? included.filter((file) => (verdict[file.id] ?? []).length > 0) : [];

  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) return;
    toast.error(error instanceof Error ? error.message : 'Something went wrong');
  };
  // `asked`: the mapping as it was when the button was pressed; an answer belongs to it.
  const post = async (path: string, asked: string) => {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: asked });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, data?.error || 'Something went wrong');
    return data;
  };
  const check = useMutation({
    mutationFn: (asked: string) => post(`/api/manual-downloads/${id}/import?preview=1`, asked) as Promise<{ files: Array<{ fileId: string; rejections: string[] }> }>,
    onSuccess: (data, asked) => setPreview({ key: asked, rejections: Object.fromEntries(data.files.map((file) => [file.fileId, file.rejections])) }),
    onError,
  });
  const importFiles = useMutation({
    mutationFn: (asked: string) => post(`/api/manual-downloads/${id}/import`, asked),
    onSuccess: () => {
      setConfirming(false);
      toast.success('Importing');
      void queryClient.invalidateQueries({ queryKey: ['manual-downloads'] });
      router.replace(`/torrents/linked/${id}`);
    },
    onError,
  });
  const busy = check.isPending || importFiles.isPending;

  const setDecision = (fileId: string, next: Partial<Decision>) => {
    setDecisions((previous) => {
      const all = { ...(previous ?? {}) };
      // A movie takes one file: including one leaves the others.
      if (next.include && download?.service === 'RADARR') for (const other of Object.keys(all)) all[other] = { ...all[other], include: false };
      all[fileId] = { ...all[fileId], ...next };
      return all;
    });
  };
  const toggleEpisode = (fileId: string, episodeId: number) => {
    const chosen = current[fileId]?.episodeIds ?? [];
    setDecision(fileId, { episodeIds: chosen.includes(episodeId) ? chosen.filter((other) => other !== episodeId) : [...chosen, episodeId] });
  };

  if (query.isPending) {
    return <div className="animate-content-in"><PageHeader title="Map files" /><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div></div>;
  }
  if (!download || download.mode !== 'QBIT_REVIEWED') {
    return <div className="animate-content-in"><PageHeader title="Map files" /><p className="py-12 text-center text-sm text-muted-foreground">There are no files to map here.</p></div>;
  }
  const app = appName(download);
  const waiting = download.status === 'NEEDS_MAPPING' || download.status === 'BLOCKED';
  const byEpisodeId = new Map(episodes.map((episode) => [episode.id, episode]));

  return (
    <div className="animate-content-in">
      <PageHeader title="Map files" subtitle={`${download.arrItemTitle} · ${download.instanceLabel}`} />
      <div className="mt-1 space-y-4 pb-8">
        <p className="text-sm text-muted-foreground">
          {isSeries
            ? `Choose which files to import and the episodes each one holds. ${app}'s own reading is shown; it is a suggestion.`
            : `Choose the file to import as ${download.arrItemTitle}. ${app}'s own reading is shown; it is a suggestion.`}
        </p>
        {!waiting && <p className="text-sm text-amber-500">This download is not waiting for a mapping now.</p>}
        {files.length === 0 && <p className="text-sm text-muted-foreground">{app} found no video among the chosen files.</p>}

        {files.map((file) => {
          const decision = current[file.id] ?? { include: false, episodeIds: [] };
          const arr = file.arr!;
          const reading = [
            arr.movie?.title ?? arr.series?.title ?? `Not read as any ${isSeries ? 'series' : 'movie'}`,
            arr.episodes.length > 0 ? arr.episodes.map(episodeLabel).join(', ') : null,
            arr.quality, arr.languages.join(', ') || null, arr.releaseGroup,
          ].filter(Boolean).join(' · ');
          const fileObjections = objectionsOf(file);
          return (
            <section key={file.id} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="min-w-0">
                <p className="break-all text-sm font-medium">{fileName(file.path)}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)} · {app} reads: {reading}</p>
              </div>
              {fileObjections.length > 0 && (
                <ul className="space-y-1">
                  {fileObjections.map((reason) => (
                    <li key={reason} className="flex gap-2 text-xs text-amber-500"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{reason}</li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2" role="group" aria-label={`What to do with ${fileName(file.path)}`}>
                <Button type="button" size="sm" className="flex-1" variant={decision.include ? 'default' : 'outline'} aria-pressed={decision.include} onClick={() => setDecision(file.id, { include: true })} disabled={busy || !canManage}>Import</Button>
                <Button type="button" size="sm" className="flex-1" variant={decision.include ? 'outline' : 'default'} aria-pressed={!decision.include} onClick={() => setDecision(file.id, { include: false })} disabled={busy || !canManage}>Leave it</Button>
              </div>
              {decision.include && !isSeries && <p className="text-xs text-muted-foreground">Imports as {download.arrItemTitle}.</p>}
              {decision.include && isSeries && (
                <div className="space-y-2">
                  <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm" onClick={() => setOpenPicker(openPicker === file.id ? null : file.id)} aria-expanded={openPicker === file.id}>
                    <span className="min-w-0 truncate">
                      {decision.episodeIds.length > 0
                        ? decision.episodeIds.map((episodeId) => { const episode = byEpisodeId.get(episodeId); return episode ? episodeLabel(episode) : `#${episodeId}`; }).join(', ')
                        : 'Choose the episodes'}
                    </span>
                    {openPicker === file.id ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  </button>
                  {openPicker === file.id && (
                    <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border p-3">
                      {episodesQuery.isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : seasons.map(([season, list]) => (
                        <div key={season} className="space-y-1">
                          <p className="tracked-caps text-[10px] text-muted-foreground">{season === 0 ? 'Specials' : `Season ${season}`}</p>
                          {list.map((episode) => (
                            <label key={episode.id} className="flex min-h-[40px] items-center gap-3 text-sm">
                              <input type="checkbox" checked={decision.episodeIds.includes(episode.id)} onChange={() => toggleEpisode(file.id, episode.id)} disabled={busy || !canManage} className="h-4 w-4 shrink-0 rounded border-border" />
                              <span className="font-mono text-xs">{episodeLabel(episode)}</span>
                              <span className="min-w-0 truncate text-muted-foreground">{episode.title}</span>
                              {episode.hasFile && <span className="shrink-0 text-[10px] text-muted-foreground">has a file</span>}
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {extras.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Also chosen, not offered by {app} for import: {extras.map((file) => fileName(file.path)).join(', ')}. {app} brings subtitles and extras along with a video it imports; a video it did not offer cannot be imported from here.
          </p>
        )}

        {canManage && waiting && files.length > 0 && (
          <div className="space-y-2">
            {verdict ? (
              <Button className="w-full" onClick={() => (objections.length > 0 ? setConfirming(true) : importFiles.mutate(key))} disabled={busy || included.length === 0 || missingEpisodes}>
                {importFiles.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Import {included.length} file{included.length === 1 ? '' : 's'}
              </Button>
            ) : (
              <Button className="w-full" onClick={() => check.mutate(key)} disabled={busy || included.length === 0 || missingEpisodes}>
                {check.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Check with {app}
              </Button>
            )}
            {missingEpisodes && <p className="text-center text-xs text-muted-foreground">Choose the episodes for each file you import.</p>}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Import despite ${app}'s objections?`}
        description={`${objections.map((file) => `${fileName(file.path)}: ${objectionsOf(file).join('; ')}`).join(' — ')}. ${app} imports them as you mapped them.`}
        confirmLabel="Import anyway"
        busy={importFiles.isPending}
        onConfirm={() => importFiles.mutate(key)}
      />
    </div>
  );
}
