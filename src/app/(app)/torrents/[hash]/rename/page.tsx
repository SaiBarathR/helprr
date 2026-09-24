'use client';

import { useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useCan } from '@/components/permission-provider';
import type { QBittorrentSummaryResponse, QBittorrentTorrent } from '@/types';
import { torrentQueryKey, useTorrent, useTorrentAction } from '../../_components/use-torrent';

export default function RenameTorrentPage() {
  const { hash } = useParams<{ hash: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canManage = useCan('torrents.manage');
  const torrentQuery = useTorrent(hash);
  const torrent = torrentQuery.data;
  const runAction = useTorrentAction();
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed once: a background refetch must not overwrite what is being typed.
  if (torrent && name === null) setName(torrent.name);

  const newName = (name ?? '').trim();
  const canSave = !!torrent && newName !== '' && newName !== torrent.name && !saving;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    const ok = await runAction({ hash, action: 'rename', name: newName });
    setSaving(false);
    if (!ok) return;
    // The list paints its cached summary before refetching; show the new name there at once.
    const rename = (t: QBittorrentTorrent) => (t.hash === hash ? { ...t, name: newName } : t);
    queryClient.setQueryData<QBittorrentTorrent | null>(torrentQueryKey(hash), (old) => (old ? rename(old) : old));
    queryClient.setQueriesData<QBittorrentSummaryResponse>(
      { queryKey: ['torrents', 'summary'] },
      (old) => (old ? { ...old, torrents: old.torrents.map(rename) } : old),
    );
    toast.success('Renamed');
    router.back();
  };

  if (!canManage) {
    return (
      <>
        <PageHeader title="Rename Torrent" />
        <p className="py-16 text-center text-sm text-muted-foreground">
          You don&apos;t have permission to rename torrents.
        </p>
      </>
    );
  }

  if (torrentQuery.isLoading) {
    return <><PageHeader title="Rename Torrent" /><PageSpinner /></>;
  }

  if (!torrent) {
    return (
      <>
        <PageHeader title="Rename Torrent" />
        {torrentQuery.isError ? (
          <ErrorState
            message="Failed to load the torrent."
            onRetry={() => void torrentQuery.refetch()}
            retrying={torrentQuery.isFetching}
          />
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">
            This torrent is no longer in qBittorrent.
          </p>
        )}
      </>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title="Rename Torrent" />

      <form className="mt-3 pb-8" onSubmit={handleSubmit}>
        <GroupedSection title="Name">
          <div className="grouped-row">
            <Input
              value={name ?? ''}
              onChange={(e) => setName(e.target.value)}
              placeholder="Torrent name"
              aria-label="Torrent name"
              disabled={saving}
              autoFocus
            />
          </div>
        </GroupedSection>

        <div className="flex gap-3">
          <Button type="submit" className="flex-1" disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Rename
          </Button>
          <Button type="button" variant="outline" className="flex-1" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
