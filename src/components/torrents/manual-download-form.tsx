'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, CircleAlert, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TagSelector } from '@/components/media/tag-selector';
import { useCan } from '@/components/permission-provider';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { useQualityProfiles, useRootFolders } from '@/lib/hooks/use-reference-data';
import { resolveAddPageInstance } from '@/lib/add-page-instances';
import type { PreflightResult } from '@/lib/manual-downloads/preflight';
import type { RadarrLookupResult, SonarrLookupResult } from '@/types';

type Service = 'RADARR' | 'SONARR';

export type ReleaseInput = { kind: 'magnet'; magnet: string } | { kind: 'file'; file: File | null };

/** "Send again" from a linked download: the same title and release name; the magnet or file is given again. */
export interface LinkPrefill {
  service: Service;
  instanceId?: string;
  externalId: number;
  title: string;
  release: string;
}

interface Target {
  externalId: number;
  title: string;
  year: number;
  inLibrary: boolean;
}

/** What the advanced fallback needs from this form before the files are chosen. */
export interface FallbackDraft {
  service: Service;
  instanceId: string;
  externalId: number;
  title: string;
  add?: Record<string, unknown>;
}

interface ManualDownloadFormProps {
  release: ReleaseInput;
  /** The release's own name (the magnet's dn, or the .torrent's file name). */
  suggestedName: string;
  prefill: LinkPrefill | null;
  /** Offered when the user may pick files: add the torrent stopped and choose its files next. */
  onChooseFiles?: (draft: FallbackDraft) => void;
  choosingFiles?: boolean;
}

// Each picked .torrent file gets its own identity: two files with the same
// name, size and date are still different submissions.
const fileIdentities = new WeakMap<File, string>();
function fileIdentity(file: File): string {
  let identity = fileIdentities.get(file);
  if (!identity) {
    identity = newRequestId();
    fileIdentities.set(file, identity);
  }
  return identity;
}

// The idempotency key of one submission; works on plain-http installs too.
export function newRequestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Check and Send both run under this key, so the page can hold still while either is on its way. */
export const MANUAL_DOWNLOAD_MUTATION_KEY = ['manual-downloads', 'submit'] as const;

const SERVICE_PATH = { RADARR: 'radarr', SONARR: 'sonarr' } as const;
const APP = { RADARR: 'Radarr', SONARR: 'Sonarr' } as const;

/**
 * Sending a magnet or .torrent to Sonarr/Radarr for one title: Arr grabs it
 * through its own download client and imports it. The server checks
 * everything first (the preflight) and shows what Arr will do; sending is
 * only offered for the exact choices that were checked.
 */
export function ManualDownloadForm({ release, suggestedName, prefill, onChooseFiles, choosingFiles = false }: ManualDownloadFormProps) {
  const router = useRouter();
  const canMovies = useCan('movies.add');
  const canSeries = useCan('series.add');
  const canMonitorMovies = useCan('movies.editMonitoring');
  const canMonitorSeries = useCan('series.editMonitoring');

  const [service, setService] = useState<Service>(prefill?.service ?? (canMovies ? 'RADARR' : 'SONARR'));
  const [instanceId, setInstanceId] = useState<string | undefined>(undefined);
  const [term, setTerm] = useState(prefill?.title ?? '');
  const [submittedTerm, setSubmittedTerm] = useState(prefill?.title ?? '');
  const [wantedId, setWantedId] = useState<number | null>(prefill?.externalId ?? null);
  const [target, setTarget] = useState<Target | null>(null);
  const [nameOverride, setNameOverride] = useState<string | null>(prefill?.release ?? null);
  const [profileId, setProfileId] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [tags, setTags] = useState<number[]>([]);
  const [minimumAvailability, setMinimumAvailability] = useState('released');
  const [seriesType, setSeriesType] = useState('standard');
  const [seasonFolder, setSeasonFolder] = useState(true);
  const [monitorTarget, setMonitorTarget] = useState(false);
  const [monitorOffered, setMonitorOffered] = useState(false);
  const [downloadClientId, setDownloadClientId] = useState<number | undefined>(undefined);
  const [clientChoices, setClientChoices] = useState<PreflightResult['plan']['downloadClientChoices']>([]);
  const [checked, setChecked] = useState<{ key: string; result: PreflightResult } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const requestIdRef = useRef<{ key: string; id: string } | null>(null);

  const path = SERVICE_PATH[service];
  const app = APP[service];
  const releaseName = nameOverride ?? suggestedName;

  const instancesQuery = useQuery({
    queryKey: queryKeys.arrInstances(),
    queryFn: jsonFetcher<Array<{ id: string; type: string; label: string; isDefault: boolean }>>('/api/instances'),
  });
  const instances = useMemo(
    () => (Array.isArray(instancesQuery.data) ? instancesQuery.data : []).filter((instance) => instance.type === service),
    [instancesQuery.data, service],
  );
  if (instanceId === undefined && instances.length > 0) setInstanceId(resolveAddPageInstance(instances, prefill?.instanceId));

  const { data: profiles = [] } = useQualityProfiles(path, instanceId);
  const { data: rootFolders = [] } = useRootFolders(path, instanceId);
  if (profiles.length > 0 && !profiles.some((profile) => String(profile.id) === profileId)) setProfileId(String(profiles[0].id));
  if (rootFolders.length > 0 && !rootFolders.some((folder) => folder.path === rootFolder)) setRootFolder(rootFolders[0].path);

  const lookup = useQuery({
    queryKey: [path, 'lookup', instanceId ?? 'default', submittedTerm],
    queryFn: jsonFetcher<Array<RadarrLookupResult | SonarrLookupResult>>(`/api/${path}/lookup?term=${encodeURIComponent(submittedTerm)}`, instanceId),
    enabled: submittedTerm.trim().length > 0 && instanceId !== undefined,
    staleTime: 60_000,
  });
  const results = useMemo(() => (lookup.data ?? []).slice(0, 8).map((item): Target => ({
    externalId: service === 'RADARR' ? (item as RadarrLookupResult).tmdbId : (item as SonarrLookupResult).tvdbId,
    title: item.title,
    year: item.year,
    inLibrary: item.library?.exists === true,
  })), [lookup.data, service]);
  // A prefilled or re-looked-up title is chosen again once its lookup arrives.
  if (wantedId !== null && lookup.data) {
    setTarget(results.find((item) => item.externalId === wantedId) ?? null);
    setWantedId(null);
  }

  function resetChecks() {
    setMonitorTarget(false);
    setMonitorOffered(false);
    setDownloadClientId(undefined);
    setClientChoices([]);
  }
  function chooseService(next: Service) {
    if (next === service) return;
    setService(next);
    setInstanceId(undefined);
    setTarget(null);
    setWantedId(null);
    setSubmittedTerm('');
    setProfileId('');
    setRootFolder('');
    setTags([]);
    resetChecks();
  }
  function chooseInstance(next: string) {
    if (next === instanceId) return;
    // Ids are per instance: look the title up again there.
    if (target) setWantedId(target.externalId);
    setTarget(null);
    setInstanceId(next);
    setProfileId('');
    setRootFolder('');
    setTags([]);
    resetChecks();
  }

  const sourceReady = release.kind === 'magnet' ? release.magnet.trim().length > 0 : release.file !== null;
  const addOptions = target && !target.inLibrary
    ? {
        qualityProfileId: Number(profileId),
        rootFolderPath: rootFolder,
        tags,
        ...(service === 'RADARR' ? { minimumAvailability } : { seriesType, seasonFolder }),
      }
    : undefined;
  const body = target && instanceId && sourceReady && (!addOptions || (profileId && rootFolder))
    ? {
        service,
        instanceId,
        externalId: target.externalId,
        ...(release.kind === 'magnet' ? { magnetUrl: release.magnet.trim() } : {}),
        ...(releaseName.trim() ? { releaseTitle: releaseName.trim() } : {}),
        ...(addOptions ? { add: addOptions } : {}),
        ...(monitorTarget ? { monitorTarget: true } : {}),
        ...(downloadClientId ? { downloadClientId } : {}),
      }
    : null;
  const fileKey = release.kind === 'file' && release.file ? fileIdentity(release.file) : '';
  const key = body ? JSON.stringify(body) + fileKey : '';
  const result = checked && checked.key === key ? checked.result : null;

  /** One request, fixed when it is made: an answer belongs to what was asked, not to what is on screen when it arrives. */
  function request(extra: Record<string, unknown> = {}) {
    const data = new FormData();
    data.append('request', JSON.stringify({ ...body, ...extra }));
    if (release.kind === 'file' && release.file) data.append('torrent', release.file);
    return { key, data };
  }
  function remember(result: PreflightResult, askedKey: string) {
    setChecked({ key: askedKey, result });
    // What the check offers belongs to the choices it checked. The mutation calls the
    // latest render's callbacks, so `key` here is what is on screen now.
    if (askedKey !== key) return;
    if (result.errors.some((issue) => issue.code === 'TARGET_UNMONITORED') || result.warnings.some((issue) => issue.code === 'TARGET_WILL_BE_MONITORED')) {
      setMonitorOffered(true);
    }
    if (result.plan.downloadClientChoices.length > 1) setClientChoices(result.plan.downloadClientChoices);
  }
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) return;
    toast.error(error instanceof Error ? error.message : 'Something went wrong');
  };

  const check = useMutation({
    mutationKey: MANUAL_DOWNLOAD_MUTATION_KEY,
    mutationFn: async (asked: { key: string; data: FormData }) => {
      const res = await fetch('/api/manual-downloads/preflight', { method: 'POST', body: asked.data });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.error || 'The check could not run');
      return data as PreflightResult;
    },
    onSuccess: (result, asked) => remember(result, asked.key),
    onError,
  });

  const send = useMutation({
    mutationKey: MANUAL_DOWNLOAD_MUTATION_KEY,
    mutationFn: async (asked: { key: string; data: FormData }) => {
      const res = await fetch('/api/manual-downloads', { method: 'POST', body: asked.data });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.plan) return { refused: data as PreflightResult };
      if (!res.ok) throw new ApiError(res.status, data?.error || 'The download could not be sent');
      return { download: data.download as { id: string; status: string } };
    },
    onSuccess: (outcome, asked) => {
      if ('refused' in outcome && outcome.refused) {
        remember(outcome.refused, asked.key);
        return;
      }
      const download = outcome.download!;
      if (download.status === 'QUEUED') toast.success(`${app} grabbed it`);
      else if (download.status === 'FAILED') toast.error(`${app} did not take it`);
      else toast.warning('Sent, but it needs a look');
      router.push(`/torrents/linked/${download.id}`);
    },
    onError,
  });
  const busy = check.isPending || send.isPending || choosingFiles;
  const draftReady = Boolean(target && instanceId && sourceReady && (!addOptions || (profileId && rootFolder)));

  return (
    <div className="space-y-4">
      {canMovies && canSeries && (
        <div className="flex gap-2" role="group" aria-label="Library">
          {(['RADARR', 'SONARR'] as const).map((value) => (
            <Button key={value} type="button" size="sm" className="flex-1" variant={service === value ? 'default' : 'outline'} onClick={() => chooseService(value)} disabled={busy}>
              {value === 'RADARR' ? 'Movie (Radarr)' : 'Series (Sonarr)'}
            </Button>
          ))}
        </div>
      )}

      {instances.length > 1 && (
        <Field label={`${app} instance`} htmlFor="link-instance">
          <Select value={instanceId ?? ''} onValueChange={chooseInstance} disabled={busy}>
            <SelectTrigger id="link-instance" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {instances.map((instance) => <SelectItem key={instance.id} value={instance.id}>{instance.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      )}
      {instancesQuery.isSuccess && instances.length === 0 && (
        <p className="text-sm text-muted-foreground">No {app} instance is connected.</p>
      )}

      <Field label={service === 'RADARR' ? 'Movie' : 'Series'} htmlFor="link-search">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setTarget(null);
            setWantedId(null);
            resetChecks();
            setSubmittedTerm(term.trim());
          }}
        >
          <Input id="link-search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder={`Search ${app}`} disabled={busy} />
          <Button type="submit" className="w-10 shrink-0 p-0" disabled={busy || !term.trim()} aria-label={`Search ${app}`}>
            {lookup.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>
        {submittedTerm && !target && !lookup.isFetching && (
          lookup.isError ? <p className="text-xs text-destructive">The search failed.</p>
            : results.length === 0 && lookup.isSuccess ? <p className="text-xs text-muted-foreground">Nothing found.</p>
            : (
              <ul className="divide-y divide-border rounded-lg border">
                {results.map((item) => (
                  <li key={item.externalId}>
                    <button
                      type="button"
                      className="press-feedback flex w-full min-h-[44px] items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                      onClick={() => { setTarget(item); resetChecks(); }}
                    >
                      <span className="min-w-0 truncate">{item.title}{item.year ? <> <span className="text-muted-foreground">({item.year})</span></> : null}</span>
                      {item.inLibrary && <span className="shrink-0 text-[11px] text-muted-foreground">In library</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )
        )}
        {target && (
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2">
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">{target.title}{target.year ? ` (${target.year})` : ''}</p>
              <p className="text-xs text-muted-foreground">
                {target.inLibrary ? 'In the library' : `Not in the library yet: Helprr adds it, with ${app}'s searches off`}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => { setTarget(null); resetChecks(); }} disabled={busy}>Change</Button>
          </div>
        )}
      </Field>

      {target && !target.inLibrary && (
        <div className="space-y-3">
          <Field label="Quality profile" htmlFor="link-profile">
            <Select value={profileId} onValueChange={setProfileId} disabled={busy}>
              <SelectTrigger id="link-profile" className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{profiles.map((profile) => <SelectItem key={profile.id} value={String(profile.id)}>{profile.name}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Root folder" htmlFor="link-root">
            <Select value={rootFolder} onValueChange={setRootFolder} disabled={busy}>
              <SelectTrigger id="link-root" className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{rootFolders.map((folder) => <SelectItem key={folder.path} value={folder.path}>{folder.path}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {service === 'RADARR' ? (
            <Field label="Minimum availability" htmlFor="link-availability">
              <Select value={minimumAvailability} onValueChange={setMinimumAvailability} disabled={busy}>
                <SelectTrigger id="link-availability" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="announced">Announced</SelectItem>
                  <SelectItem value="inCinemas">In Cinemas</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <>
              <Field label="Series type" htmlFor="link-series-type">
                <Select value={seriesType} onValueChange={setSeriesType} disabled={busy}>
                  <SelectTrigger id="link-series-type" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="anime">Anime</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <label className="flex min-h-[44px] items-center justify-between gap-3">
                <span className="text-sm">Season folders</span>
                <Switch checked={seasonFolder} onCheckedChange={setSeasonFolder} disabled={busy} />
              </label>
            </>
          )}
          <Field label="Tags">
            <TagSelector service={path} instanceId={instanceId} value={tags} onChange={setTags} />
          </Field>
        </div>
      )}

      {onChooseFiles && (
        <label className="flex min-h-[44px] items-start gap-3 py-1">
          <input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 shrink-0 rounded border-border" />
          <span className="text-sm">
            Choose files before download (advanced)
            <span className="block text-xs text-muted-foreground">
              qBittorrent downloads only the files you pick, then {app} is asked what each one is. Less automatic: when {app} is unsure of a file, you decide what it is.
            </span>
          </span>
        </label>
      )}

      {!advanced && (
      <Field label="Release name" htmlFor="link-release" hint={`${app} reads the title, episodes and quality from this name.`}>
        <Input
          id="link-release"
          value={releaseName}
          onChange={(event) => setNameOverride(event.target.value)}
          placeholder={release.kind === 'file' ? "The torrent's own name" : 'The name in the magnet link'}
          disabled={busy}
        />
      </Field>
      )}

      {!advanced && monitorOffered && target && !(service === 'RADARR' ? canMonitorMovies : canMonitorSeries) && (
        <p className="text-xs text-muted-foreground">
          {app} only takes a release for a monitored title, and this account may not change monitoring: ask someone who may to monitor {target.title}{service === 'SONARR' ? ' and the episodes this release covers' : ''} first.
        </p>
      )}
      {!advanced && monitorOffered && target && (service === 'RADARR' ? canMonitorMovies : canMonitorSeries) && (
        <label className="flex min-h-[44px] items-start gap-3 py-1">
          <input type="checkbox" checked={monitorTarget} onChange={(event) => setMonitorTarget(event.target.checked)} disabled={busy} className="mt-0.5 h-4 w-4 shrink-0 rounded border-border" />
          <span className="text-sm">
            Monitor {target.title}{service === 'SONARR' ? ' and the episodes this release covers' : ''}
            <span className="block text-xs text-muted-foreground">{app} only takes a release for a monitored title.</span>
          </span>
        </label>
      )}

      {!advanced && clientChoices.length > 1 && (
        <Field label="Download client" htmlFor="link-client" hint={`${app} has several torrent clients; choose the one to use.`}>
          <Select value={downloadClientId ? String(downloadClientId) : ''} onValueChange={(value) => setDownloadClientId(Number(value))} disabled={busy}>
            <SelectTrigger id="link-client" className="w-full"><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent>{clientChoices.map((choice) => <SelectItem key={choice.id} value={String(choice.id)}>{choice.name}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      )}

      {!advanced && result && <PreflightSummary result={result} app={app} />}

      <div className="space-y-2 pt-1">
        {advanced ? (
          <Button
            className="w-full"
            disabled={busy || !draftReady}
            onClick={() => onChooseFiles!({ service, instanceId: instanceId!, externalId: target!.externalId, title: target!.title, ...(addOptions ? { add: addOptions } : {}) })}
          >
            {choosingFiles && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Next: choose files
          </Button>
        ) : result?.ok ? (
          <Button
            className="w-full"
            onClick={() => {
              // The same submission keeps its id, so a retry after a lost answer returns the same download.
              if (requestIdRef.current?.key !== key) requestIdRef.current = { key, id: newRequestId() };
              send.mutate(request({ clientRequestId: requestIdRef.current.id }));
            }}
            disabled={busy}
          >
            {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send to {app}
          </Button>
        ) : (
          <Button className="w-full" onClick={() => check.mutate(request())} disabled={busy || !body}>
            {check.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {checked ? 'Check again' : 'Check'}
          </Button>
        )}
        {!body && !busy && (
          <p className="text-center text-xs text-muted-foreground">
            {!sourceReady ? (release.kind === 'magnet' ? 'Paste a magnet link first.' : 'Choose a .torrent file first.') : !target ? `Choose the ${service === 'RADARR' ? 'movie' : 'series'} it is for.` : 'Choose a quality profile and root folder.'}
          </p>
        )}
        <Button variant="outline" className="w-full" onClick={() => router.push('/torrents')} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function episodeLabel(episode: { seasonNumber: number; episodeNumber: number }) {
  return `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;
}

/** What the server found: what Arr read from the name, what it will do, and anything in the way. */
export function PreflightSummary({ result, app }: { result: PreflightResult; app: string }) {
  const { plan } = result;
  const read = [
    plan.parsed?.quality,
    plan.parsed?.year ? String(plan.parsed.year) : null,
    plan.parsed?.fullSeason && plan.parsed.seasonNumber !== undefined ? `Season ${plan.parsed.seasonNumber}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <section className={`space-y-3 rounded-lg border p-3 ${result.ok ? 'border-green-500/40' : 'border-destructive/40'}`} aria-live="polite">
      <p className={`flex items-center gap-2 text-sm font-medium ${result.ok ? 'text-green-500' : 'text-destructive'}`}>
        {result.ok ? <Check className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
        {result.ok ? `Ready: ${app} will take it` : 'Not ready to send'}
      </p>
      <dl className="space-y-1.5 text-xs">
        {plan.target && (
          <div><dt className="inline text-muted-foreground">For: </dt><dd className="inline">{plan.target.title}{plan.target.year ? ` (${plan.target.year})` : ''}{plan.target.existingId ? '' : `, will be added to ${plan.instance?.label ?? app}`}</dd></div>
        )}
        {read && <div><dt className="inline text-muted-foreground">{app} reads: </dt><dd className="inline">{read}</dd></div>}
        {plan.episodes.length > 0 && (
          <div><dt className="inline text-muted-foreground">Episodes: </dt><dd className="inline">{plan.episodes.map(episodeLabel).join(', ')}</dd></div>
        )}
        {plan.downloadClient && <div><dt className="inline text-muted-foreground">Download client: </dt><dd className="inline">{plan.downloadClient.name}</dd></div>}
      </dl>
      {result.errors.length > 0 && (
        <ul className="space-y-1.5">
          {result.errors.map((issue) => (
            <li key={issue.code} className="flex gap-2 text-xs text-destructive"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue.message}</li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {result.warnings.map((issue) => (
            <li key={issue.code} className="flex gap-2 text-xs text-amber-500"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issue.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
