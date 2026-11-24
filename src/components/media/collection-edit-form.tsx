'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { TagSelector } from '@/components/media/tag-selector';
import { useQualityProfiles, useRootFolders } from '@/lib/hooks/use-reference-data';
import { invalidateCollections } from '@/lib/query-invalidation';
import { ApiError } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import type { CollectionSummary } from '@/types';

/** The collection options Edit collection can change; an absent field stays as it is. */
export interface CollectionEditChanges {
  monitorMovies?: boolean;
  qualityProfileId?: number;
  minimumAvailability?: 'announced' | 'inCinemas' | 'released';
  rootFolderPath?: string;
  searchOnAdd?: boolean;
  tags?: number[];
}

export async function saveCollectionEdit(collection: CollectionSummary, changes: CollectionEditChanges): Promise<void> {
  const res = await fetch('/api/radarr/collections', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId: collection.id, instanceId: collection.instanceId, ...changes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new ApiError(res.status, err?.error || `Request failed (${res.status})`);
  }
}

// Radix Select can't hold an empty value, so "leave as is" is a sentinel.
const KEEP = 'keep';

const sameTags = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * Edit collection: what Radarr applies when it adds one of the collection's movies,
 * plus (un)monitoring the movies already in Radarr. Each part shows only to a user
 * the API lets change it, and only changed fields are sent.
 */
export function CollectionEditForm({
  collection,
  isAdmin,
  canMonitor,
  canEditTags,
  canChangePath,
  onSaved,
  onCancel,
}: {
  collection: CollectionSummary;
  isAdmin: boolean;
  canMonitor: boolean;
  canEditTags: boolean;
  canChangePath: boolean;
  onSaved: (changes: CollectionEditChanges) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const instanceId = collection.instanceId;
  const { data: qualityProfiles = [] } = useQualityProfiles('radarr', instanceId, isAdmin);
  const { data: rootFolders = [] } = useRootFolders('radarr', instanceId, canChangePath);

  const [monitorMovies, setMonitorMovies] = useState(KEEP);
  const [qualityProfileId, setQualityProfileId] = useState(collection.qualityProfileId ? String(collection.qualityProfileId) : '');
  const [minimumAvailability, setMinimumAvailability] = useState(collection.minimumAvailability ?? '');
  const [rootFolderPath, setRootFolderPath] = useState(collection.rootFolderPath ?? '');
  const [searchOnAdd, setSearchOnAdd] = useState(collection.searchOnAdd ?? false);
  const [tags, setTags] = useState<number[]>(collection.tags ?? []);
  const [saving, setSaving] = useState(false);

  const changes: CollectionEditChanges = {};
  if (canMonitor && monitorMovies !== KEEP) changes.monitorMovies = monitorMovies === 'monitor';
  if (isAdmin) {
    if (qualityProfileId && Number(qualityProfileId) !== collection.qualityProfileId) changes.qualityProfileId = Number(qualityProfileId);
    if (minimumAvailability && minimumAvailability !== collection.minimumAvailability) {
      changes.minimumAvailability = minimumAvailability as CollectionEditChanges['minimumAvailability'];
    }
    if (searchOnAdd !== (collection.searchOnAdd ?? false)) changes.searchOnAdd = searchOnAdd;
  }
  if (canChangePath && rootFolderPath && rootFolderPath !== collection.rootFolderPath) changes.rootFolderPath = rootFolderPath;
  if (canEditTags && !sameTags(tags, collection.tags ?? [])) changes.tags = tags;
  const hasChanges = Object.keys(changes).length > 0;
  const showAddOptions = isAdmin || canChangePath;

  async function save() {
    if (!hasChanges || saving) return;
    setSaving(true);
    try {
      await saveCollectionEdit(collection, changes);
      invalidateCollections(qc);
      toast.success('Collection updated');
      onSaved(changes);
    } catch (error) {
      handleAuthError(error);
      if (!(error instanceof ApiError && error.status === 401)) {
        toast.error(error instanceof Error ? error.message : 'Failed to update collection');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {canMonitor && (
        <div className="grouped-section">
          <p className="grouped-section-title">Movies in Radarr</p>
          <div className="grouped-section-content">
            <div className="grouped-row gap-3">
              <Label htmlFor="collection-monitor-movies" className="text-sm shrink-0">Monitor Movies</Label>
              <Select value={monitorMovies} onValueChange={setMonitorMovies}>
                <SelectTrigger id="collection-monitor-movies" className="w-[180px] min-w-0 border-0 bg-transparent text-right">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP}>No change</SelectItem>
                  <SelectItem value="monitor">Monitor all</SelectItem>
                  <SelectItem value="unmonitor">Unmonitor all</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="px-4 pt-2 text-xs text-muted-foreground">
            {monitorMovies === 'monitor'
              ? 'Radarr monitors every movie of this collection that is already in the library, and searches for the ones without a file.'
              : 'Applies to the movies of this collection that are already in the library.'}
          </p>
        </div>
      )}

      {showAddOptions && (
        <div className="grouped-section">
          <p className="grouped-section-title">Adding Movies</p>
          <div className="grouped-section-content">
            {isAdmin && (
              <div className="grouped-row gap-3">
                <Label htmlFor="collection-quality-profile" className="text-sm shrink-0">Quality Profile</Label>
                <Select value={qualityProfileId} onValueChange={setQualityProfileId}>
                  <SelectTrigger id="collection-quality-profile" className="w-[180px] min-w-0 border-0 bg-transparent text-right">
                    <SelectValue placeholder="Select profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {qualityProfiles.map((qp) => (
                      <SelectItem key={qp.id} value={String(qp.id)}>{qp.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isAdmin && (
              <div className="grouped-row gap-3">
                <Label htmlFor="collection-minimum-availability" className="text-sm shrink-0">Minimum Availability</Label>
                <Select value={minimumAvailability} onValueChange={setMinimumAvailability}>
                  <SelectTrigger id="collection-minimum-availability" className="w-[180px] min-w-0 border-0 bg-transparent text-right">
                    <SelectValue placeholder="Select availability" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="announced">Announced</SelectItem>
                    <SelectItem value="inCinemas">In Cinemas</SelectItem>
                    <SelectItem value="released">Released</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {canChangePath && (
              <div className="grouped-row gap-3">
                <Label htmlFor="collection-root-folder" className="text-sm shrink-0">Root Folder</Label>
                <Select value={rootFolderPath} onValueChange={setRootFolderPath}>
                  <SelectTrigger id="collection-root-folder" className="w-[180px] min-w-0 border-0 bg-transparent text-right" title={rootFolderPath || undefined}>
                    <SelectValue placeholder="Select folder">{rootFolderPath ? <span className="truncate">{rootFolderPath}</span> : null}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {rootFolders.map((rf) => (
                      <SelectItem key={rf.id} value={rf.path}>{rf.path}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isAdmin && (
              <div className="grouped-row gap-3">
                <Label htmlFor="collection-search-on-add" className="text-sm min-w-0">Search on Add</Label>
                <Switch id="collection-search-on-add" checked={searchOnAdd} onCheckedChange={setSearchOnAdd} />
              </div>
            )}
          </div>
          <p className="px-4 pt-2 text-xs text-muted-foreground">
            Radarr uses these when it adds a movie from this collection. Movies already in the library keep their own settings.
          </p>
        </div>
      )}

      {canEditTags && (
        <div className="grouped-section">
          <p className="grouped-section-title">Tags</p>
          <div className="grouped-section-content">
            <div className="px-4 py-3">
              <TagSelector service="radarr" instanceId={instanceId} value={tags} onChange={setTags} />
            </div>
          </div>
          <p className="px-4 pt-2 text-xs text-muted-foreground">Movies added from this collection get these tags.</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button className="flex-1" onClick={save} disabled={!hasChanges || saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
