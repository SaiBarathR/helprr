'use client';

import { useEffect, useState } from 'react';
import { ApiError, withInstanceQuery } from '@/lib/query-fetch';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useQualityProfiles, useRootFolders, useTags } from '@/lib/hooks/use-reference-data';
import type { RadarrMovie } from '@/types';

async function radarrFetch(instance: string | undefined, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(withInstanceQuery(path, instance), init);
  // 401 = session revoked mid-view; throw so the global QueryCache/MutationCache
  // handler redirects to /login instead of swallowing it into an empty read.
  if (res.status === 401) throw new ApiError(401, `${path} → 401`);
  return res;
}

export default function MovieEditPage() {
  const { id } = useParams();
  const router = useRouter();
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();

  const [movie, setMovie] = useState<RadarrMovie | null>(null);
  const { data: qualityProfiles = [] } = useQualityProfiles('radarr', instance);
  const { data: rootFolders = [] } = useRootFolders('radarr', instance);
  const { data: tags = [] } = useTags('radarr', instance);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [qualityProfileId, setQualityProfileId] = useState<number>(0);
  const [minimumAvailability, setMinimumAvailability] = useState('');
  const [rootFolder, setRootFolder] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);

  useEffect(() => {
    radarrFetch(instance, `/api/radarr/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m: RadarrMovie | null) => {
        setMovie(m);
        if (m) {
          setQualityProfileId(m.qualityProfileId);
          setMinimumAvailability(m.minimumAvailability);
          setSelectedTags([...m.tags]);
          setRootFolder(
            m.path ? m.path.split('/').slice(0, -1).join('/') : ''
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, instance]);

  function toggleTag(tagId: number) {
    setSelectedTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((t) => t !== tagId)
        : [...prev, tagId]
    );
  }

  async function handleSave() {
    if (!movie) return;
    setSaving(true);

    try {
      const updatedMovie = {
        ...movie,
        qualityProfileId,
        minimumAvailability,
        tags: selectedTags,
      };

      // Update root folder path if changed
      if (rootFolder && movie.path) {
        const movieFolder = movie.path.split('/').pop();
        updatedMovie.path = `${rootFolder}/${movieFolder}`;
      }

      const res = await radarrFetch(instance, `/api/radarr/${movie.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMovie),
      });

      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: queryKeys.library('radarr') });
        queryClient.invalidateQueries({ queryKey: queryKeys.detail('radarr', movie.id, instance) });
        toast.success('Movie updated');
        router.back();
      } else {
        toast.error('Failed to update movie');
      }
    } catch {
      toast.error('Failed to update movie');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <><PageHeader title="Edit Movie" /><PageSpinner /></>;
  }

  if (!movie) {
    return (
      <div>
        <PageHeader title="Edit Movie" />
        <div className="text-center py-12 text-muted-foreground">
          Movie not found
        </div>
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={`Edit ${movie.title}`} />

      <div className="px-4 space-y-6 mt-4 pb-8">
        {/* Settings Section */}
        <div className="grouped-section">
          <div className="grouped-section-title">Settings</div>
          <div className="grouped-section-content">
            {/* Quality Profile */}
            <div className="grouped-row">
              <Label className="text-sm shrink-0">Quality Profile</Label>
              <Select
                value={String(qualityProfileId)}
                onValueChange={(v) => setQualityProfileId(Number(v))}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select profile" />
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

            {/* Minimum Availability */}
            <div className="grouped-row">
              <Label className="text-sm shrink-0">Minimum Availability</Label>
              <Select
                value={minimumAvailability}
                onValueChange={setMinimumAvailability}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select availability" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="announced">Announced</SelectItem>
                  <SelectItem value="inCinemas">In Cinemas</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Root Folder */}
            {rootFolders.length > 0 && (
              <div className="grouped-row">
                <Label className="text-sm shrink-0">Root Folder</Label>
                <Select value={rootFolder} onValueChange={setRootFolder}>
                  <SelectTrigger className="w-[180px]">
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
        </div>

        {/* Tags Section */}
        {tags.length > 0 && (
          <div className="grouped-section">
            <div className="grouped-section-title">Tags</div>
            <div className="grouped-section-content">
              <div className="grouped-row">
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Badge
                      key={t.id}
                      variant={
                        selectedTags.includes(t.id) ? 'default' : 'outline'
                      }
                      className="cursor-pointer select-none"
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

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={saving}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => router.back()}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
