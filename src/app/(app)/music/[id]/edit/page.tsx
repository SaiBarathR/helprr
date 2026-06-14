'use client';

import { useEffect, useState } from 'react';
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
import {
  useQualityProfiles,
  useMetadataProfiles,
  useRootFolders,
  useTags,
} from '@/lib/hooks/use-reference-data';
import type { LidarrArtist } from '@/types';

// Append the viewing instance to a Lidarr API path so the page reads/mutates the
// correct instance. No-op (single-instance-identical) when instance is undefined.
function withInstanceQuery(url: string, instance?: string): string {
  if (!instance) return url;
  return `${url}${url.includes('?') ? '&' : '?'}instanceId=${instance}`;
}
function lidarrFetch(instance: string | undefined, path: string, init?: RequestInit): Promise<Response> {
  return fetch(withInstanceQuery(path, instance), init);
}

export default function ArtistEditPage() {
  const { id } = useParams();
  const router = useRouter();
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();

  const [artist, setArtist] = useState<LidarrArtist | null>(null);
  const { data: qualityProfiles = [] } = useQualityProfiles('lidarr', instance);
  const { data: metadataProfiles = [] } = useMetadataProfiles(instance);
  const { data: rootFolders = [] } = useRootFolders('lidarr', instance);
  const { data: tags = [] } = useTags('lidarr', instance);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [qualityProfileId, setQualityProfileId] = useState<number>(0);
  const [metadataProfileId, setMetadataProfileId] = useState<number>(0);
  const [monitorNewItems, setMonitorNewItems] = useState('all');
  const [rootFolder, setRootFolder] = useState('');
  const [selectedTags, setSelectedTags] = useState<number[]>([]);

  useEffect(() => {
    lidarrFetch(instance, `/api/lidarr/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((a: LidarrArtist | null) => {
        setArtist(a);
        if (a) {
          setQualityProfileId(a.qualityProfileId);
          setMetadataProfileId(a.metadataProfileId);
          setMonitorNewItems(a.monitorNewItems || 'all');
          setSelectedTags([...a.tags]);
          setRootFolder(a.path ? a.path.split('/').slice(0, -1).join('/') : '');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id, instance]);

  function toggleTag(tagId: number) {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  }

  async function handleSave() {
    if (!artist) return;
    setSaving(true);
    try {
      const updated: LidarrArtist = {
        ...artist,
        qualityProfileId,
        metadataProfileId,
        monitorNewItems,
        tags: selectedTags,
      };

      if (rootFolder && artist.path) {
        const artistFolder = artist.path.split('/').pop();
        updated.path = `${rootFolder}/${artistFolder}`;
      }

      const res = await lidarrFetch(instance, `/api/lidarr/${artist.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });

      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: queryKeys.library('lidarr') });
        queryClient.invalidateQueries({ queryKey: queryKeys.detail('lidarr', artist.id, instance) });
        toast.success('Artist updated');
        router.back();
      } else {
        toast.error('Failed to update artist');
      }
    } catch {
      toast.error('Failed to update artist');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
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

        {tags.length > 0 && (
          <div className="grouped-section">
            <div className="grouped-section-title">Tags</div>
            <div className="grouped-section-content">
              <div className="grouped-row">
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Badge
                      key={t.id}
                      variant={selectedTags.includes(t.id) ? 'default' : 'outline'}
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
