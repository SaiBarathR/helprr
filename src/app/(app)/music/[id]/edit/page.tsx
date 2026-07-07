'use client';

import { useState } from 'react';
import { ApiError, jsonFetcher, withInstanceQuery } from '@/lib/query-fetch';
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
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { TagSelector } from '@/components/media/tag-selector';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { invalidateMusic } from '@/lib/query-invalidation';
import {
  useQualityProfiles,
  useMetadataProfiles,
  useRootFolders,
} from '@/lib/hooks/use-reference-data';
import type { LidarrArtist } from '@/types';
import { parentPath, lastPathSegment, joinPath } from '@/lib/paths';

export default function ArtistEditPage() {
  const { id } = useParams();
  const router = useRouter();
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();
  const artistId = Number(id);

  const artistQuery = useQuery({
    queryKey: queryKeys.detail('lidarr', artistId, instance),
    queryFn: jsonFetcher<LidarrArtist>(`/api/lidarr/${artistId}`, instance),
    enabled: Number.isFinite(artistId),
  });
  const artist = artistQuery.data ?? null;
  const loading = artistQuery.isLoading;

  const { data: qualityProfiles = [] } = useQualityProfiles('lidarr', instance);
  const { data: metadataProfiles = [] } = useMetadataProfiles(instance);
  const { data: rootFolders = [] } = useRootFolders('lidarr', instance);

  const [qualityProfileId, setQualityProfileId] = useState<number>(0);
  const [metadataProfileId, setMetadataProfileId] = useState<number>(0);
  const [monitorNewItems, setMonitorNewItems] = useState('all');
  const [rootFolder, setRootFolder] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);

  // Seed the form once the artist loads (and re-seed if the cached artist
  // changes). Guarded during render.
  const [seededArtist, setSeededArtist] = useState<LidarrArtist | null>(null);
  if (artist && artist !== seededArtist) {
    setSeededArtist(artist);
    setQualityProfileId(artist.qualityProfileId);
    setMetadataProfileId(artist.metadataProfileId);
    setMonitorNewItems(artist.monitorNewItems || 'all');
    setSelectedTags([...artist.tags]);
    setRootFolder(artist.path ? parentPath(artist.path) : '');
  }

  const saveMutation = useMutation({
    mutationFn: async (updated: LidarrArtist) => {
      const res = await fetch(withInstanceQuery(`/api/lidarr/${updated.id}`, instance), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      // ApiError (not a plain Error) so a 401 carries its status to the global
      // MutationCache handler, which redirects to /login.
      if (!res.ok) throw new ApiError(res.status, 'Failed to update artist');
    },
    onSuccess: (_data, updated) => {
      invalidateMusic(queryClient, { itemId: updated.id, instanceId: instance });
      toast.success('Artist updated');
      router.back();
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error('Failed to update artist');
    },
  });
  const saving = saveMutation.isPending;

  function handleSave() {
    if (!artist) return;

    const updated: LidarrArtist = {
      ...artist,
      qualityProfileId,
      metadataProfileId,
      monitorNewItems,
      tags: selectedTags,
    };

    if (rootFolder && artist.path) {
      updated.path = joinPath(rootFolder, lastPathSegment(artist.path));
    }

    saveMutation.mutate(updated);
  }

  if (loading && !artist) {
    return <><PageHeader title="Edit Artist" /><PageSpinner /></>;
  }

  if (!artist) {
    return (
      <div>
        <PageHeader title="Edit Artist" />
        <div className="text-center py-12 text-muted-foreground">Artist not found</div>
      </div>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={`Edit ${artist.artistName}`} />

      <div className="px-4 space-y-6 mt-4 pb-8">
        <div className="grouped-section">
          <div className="grouped-section-title">Settings</div>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <Label className="text-sm shrink-0">Quality Profile</Label>
              <Select value={String(qualityProfileId)} onValueChange={(v) => setQualityProfileId(Number(v))}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select profile" /></SelectTrigger>
                <SelectContent>
                  {qualityProfiles.map((qp) => (
                    <SelectItem key={qp.id} value={String(qp.id)}>{qp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grouped-row">
              <Label className="text-sm shrink-0">Metadata Profile</Label>
              <Select value={String(metadataProfileId)} onValueChange={(v) => setMetadataProfileId(Number(v))}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select profile" /></SelectTrigger>
                <SelectContent>
                  {metadataProfiles.map((mp) => (
                    <SelectItem key={mp.id} value={String(mp.id)}>{mp.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grouped-row">
              <Label className="text-sm shrink-0">Monitor New Albums</Label>
              <Select value={monitorNewItems} onValueChange={setMonitorNewItems}>
                <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All new albums</SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {rootFolders.length > 0 && (
              <div className="grouped-row">
                <Label className="text-sm shrink-0">Root Folder</Label>
                <Select value={rootFolder} onValueChange={setRootFolder}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select folder" /></SelectTrigger>
                  <SelectContent>
                    {rootFolders.map((rf) => (
                      <SelectItem key={rf.id} value={rf.path}>{rf.path}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <div className="grouped-section">
          <div className="grouped-section-title">Tags</div>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <TagSelector
                service="lidarr"
                instanceId={instance}
                value={selectedTags}
                onChange={setSelectedTags}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button className="flex-1" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
