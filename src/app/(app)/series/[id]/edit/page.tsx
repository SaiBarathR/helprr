'use client';

import { useEffect, useRef, useState } from 'react';
import { arrMutationFetch } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { invalidateSeries } from '@/lib/query-invalidation';
import { useQualityProfiles, useRootFolders, useTags } from '@/lib/hooks/use-reference-data';
import type { SonarrSeries } from '@/types';

export default function SeriesEditPage() {
  const { id } = useParams();
  const router = useRouter();
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();

  // Shares queryKeys.detail with the series detail page (gcTime → no refetch when
  // arriving from there). null on !ok preserves the original "not found" path.
  const seriesQuery = useQuery({
    queryKey: queryKeys.detail('sonarr', Number(id), instance),
    queryFn: async ({ signal }): Promise<SonarrSeries | null> => {
      const r = await arrMutationFetch(instance, `/api/sonarr/${id}`, { signal });
      return r.ok ? ((await r.json()) as SonarrSeries) : null;
    },
    enabled: Number.isFinite(Number(id)),
  });
  const series = seriesQuery.data ?? null;
  const loading = seriesQuery.isLoading;
  const { data: qualityProfiles = [] } = useQualityProfiles('sonarr', instance);
  const { data: rootFolders = [] } = useRootFolders('sonarr', instance);
  const { data: tags = [] } = useTags('sonarr', instance);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [qualityProfileId, setQualityProfileId] = useState<number>(0);
  const [seriesType, setSeriesType] = useState('');
  const [seasonFolder, setSeasonFolder] = useState(true);
  const [rootFolder, setRootFolder] = useState('');
  const [rootFolderTouched, setRootFolderTouched] = useState(false);
  const [selectedTags, setSelectedTags] = useState<number[]>([]);

  useEffect(() => {
    if (seriesQuery.isError) toast.error('Failed to load series data');
  }, [seriesQuery.isError]);

  // Seed the form once per series — guard with a ref so a background refetch
  // (which yields a fresh `series` object reference) can't reset unsaved edits.
  const seededSeriesIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!series || seededSeriesIdRef.current === series.id) return;
    seededSeriesIdRef.current = series.id;
    setQualityProfileId(series.qualityProfileId);
    setSeriesType(series.seriesType);
    setSeasonFolder(series.seasonFolder);
    setSelectedTags([...series.tags]);
    setRootFolder(series.path ? series.path.split('/').slice(0, -1).join('/') : '');
  }, [series]);

  function toggleTag(tagId: number) {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  }

  async function handleSave() {
    if (!series) return;
    setSaving(true);
    try {
      const updatedSeries: SonarrSeries = {
        ...series,
        qualityProfileId,
        seriesType,
        seasonFolder,
        tags: selectedTags,
      };

      if (rootFolder && series.path) {
        const segments = series.path.split('/').filter(Boolean);
        const seriesFolder = segments[segments.length - 1];
        if (seriesFolder) {
          updatedSeries.path = `${rootFolder}/${seriesFolder}`;
        }
      }

      const moveFiles = rootFolderTouched;
      const url = `/api/sonarr/${series.id}${moveFiles ? '?moveFiles=true' : ''}`;

      const res = await arrMutationFetch(instance, url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      if (res.ok) {
        // Refresh the list + this series' detail/episodes so the page we return to
        // shows the saved changes (a path move can shift files).
        invalidateSeries(queryClient, { itemId: series.id, instanceId: instance });
        toast.success('Series updated');
        router.back();
      } else {
        toast.error('Failed to update series');
      }
    } catch (e) {
      handleAuthError(e);
      toast.error('Failed to update series');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <><PageHeader title="Edit Series" /><PageSpinner /></>;
  }

  if (!series) {
    return (
      <div>
        <PageHeader title="Edit Series" />
        <div className="text-center py-12 text-muted-foreground">Series not found</div>
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={`Edit ${series.title}`} />

      <div className="px-4 pt-4 pb-8 space-y-6">
        {/* Quality Profile */}
        <div className="grouped-section">
          <p className="grouped-section-title">Quality Profile</p>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <Label htmlFor="quality-profile" className="text-sm shrink-0">
                Profile
              </Label>
              <Select
                value={String(qualityProfileId)}
                onValueChange={(v) => setQualityProfileId(Number(v))}
              >
                <SelectTrigger id="quality-profile" className="w-[180px] border-0 bg-transparent text-right">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {qualityProfiles.map((qp) => (
                    <SelectItem key={qp.id} value={String(qp.id)}>
                      {qp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Series Type */}
        <div className="grouped-section">
          <p className="grouped-section-title">Series Type</p>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <Label htmlFor="series-type" className="text-sm shrink-0">
                Type
              </Label>
              <Select value={seriesType} onValueChange={setSeriesType}>
                <SelectTrigger id="series-type" className="w-[180px] border-0 bg-transparent text-right">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="anime">Anime</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Folder */}
        <div className="grouped-section">
          <p className="grouped-section-title">Folder</p>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <Label htmlFor="season-folder" className="text-sm shrink-0">
                Use Season Folder
              </Label>
              <Switch
                id="season-folder"
                checked={seasonFolder}
                onCheckedChange={setSeasonFolder}
              />
            </div>
            {rootFolders.length > 0 && (
              <div className="grouped-row">
                <Label htmlFor="root-folder" className="text-sm shrink-0">
                  Root Folder
                </Label>
                <Select
                  value={rootFolder}
                  onValueChange={(v) => {
                    setRootFolder(v);
                    setRootFolderTouched(true);
                  }}
                >
                  <SelectTrigger id="root-folder" className="w-[180px] border-0 bg-transparent text-right">
                    <SelectValue placeholder="Select folder" />
                  </SelectTrigger>
                  <SelectContent>
                    {rootFolders.map((rf) => (
                      <SelectItem key={rf.id} value={rf.path}>
                        {rf.path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <p className="px-4 pt-2 text-xs text-muted-foreground">
            Moving series to the same root folder can be used to rename series folders to match updated title or naming format.
          </p>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="grouped-section">
            <p className="grouped-section-title">Tags</p>
            <div className="grouped-section-content">
              <div className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <Badge
                      key={t.id}
                      variant={selectedTags.includes(t.id) ? 'default' : 'outline'}
                      className="cursor-pointer select-none transition-colors"
                      onClick={() => toggleTag(t.id)}
                    >
                      {t.label}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => router.back()}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
