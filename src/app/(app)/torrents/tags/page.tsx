'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useCan } from '@/components/permission-provider';
import { ApiError, jsonFetcher, withInstanceQuery } from '@/lib/query-fetch';
import { qbitInstanceKey, useQbitInstance } from '../_components/use-qbit-instance';
import { handleAuthError } from '@/lib/query-client';
import { newTagProblem } from '../_components/torrent-tags';

interface TagUsage {
  name: string;
  torrents: number;
}

const TAGS_URL = '/api/qbittorrent/tags';
const TAGS_KEY = ['qbittorrent', 'tags'] as const;

const torrentCount = (count: number) => `${count} torrent${count === 1 ? '' : 's'}`;

/** Create (POST) or delete (DELETE); the error to show, or null when it worked. */
async function sendTagChange(method: 'POST' | 'DELETE', body: Record<string, unknown>, instanceId: string | undefined): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(withInstanceQuery(TAGS_URL, instanceId), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return 'Helprr could not be reached';
  }
  if (res.status === 401) {
    handleAuthError(new ApiError(401, `${TAGS_URL} → 401`));
    return 'Signed out';
  }
  if (res.ok) return null;
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === 'string' ? data.error : 'qBittorrent did not take the change';
}

/** qBittorrent's tags, with how many torrents have each; those who manage torrents add and delete them. */
export default function TorrentTagsPage() {
  const queryClient = useQueryClient();
  const canManage = useCan('torrents.manage');
  const { instanceId, subtitle } = useQbitInstance();
  const tagsQuery = useQuery({
    queryKey: [...TAGS_KEY, qbitInstanceKey(instanceId)],
    queryFn: jsonFetcher<{ tags: TagUsage[] }>(TAGS_URL, instanceId),
    staleTime: 0,
  });
  const tags = useMemo(
    () => [...(tagsQuery.data?.tags ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [tagsQuery.data],
  );

  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Kept after the dialog closes, so its text doesn't change while it fades out.
  const [confirmDelete, setConfirmDelete] = useState<TagUsage | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // The torrent settings pages list tags too (['qbittorrent', 'options']).
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: TAGS_KEY }),
    queryClient.invalidateQueries({ queryKey: ['qbittorrent', 'options'] }),
  ]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const tag = name.trim();
    const problem = newTagProblem(tag) ?? (tags.some((t) => t.name === tag) ? `There is already a tag named ${tag}` : null);
    if (problem) {
      setCreateError(problem);
      return;
    }
    setCreating(true);
    const error = await sendTagChange('POST', { name: tag }, instanceId);
    setCreating(false);
    if (error) {
      setCreateError(error);
      return;
    }
    setName('');
    toast.success(`Created ${tag}`);
    await refresh();
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const error = await sendTagChange('DELETE', { tags: [confirmDelete.name] }, instanceId);
    setDeleting(false);
    setConfirmOpen(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(`Deleted ${confirmDelete.name}`);
    await refresh();
  };

  return (
    <div className="animate-content-in">
      <PageHeader title="Tags" subtitle={subtitle} className="*:readable-column" backHref="/torrents/settings" />

      <div className="mt-3 pb-8 readable-column">
        {tagsQuery.isLoading ? (
          <PageSpinner />
        ) : !tagsQuery.data ? (
          <ErrorState
            message="Failed to load qBittorrent's tags."
            onRetry={() => void tagsQuery.refetch()}
            retrying={tagsQuery.isFetching}
          />
        ) : (
          <>
            <GroupedSection
              title="qBittorrent Tags"
              footer={canManage
                ? 'Deleting a tag takes it off every torrent that has it. The torrents and their files stay.'
                : 'Only users who may manage torrents can add or delete tags.'}
            >
              {tags.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">No tags yet</p>
              )}
              {tags.map((tag) => (
                <div key={tag.name} className="grouped-row gap-3">
                  <div className="min-w-0 flex-1 flex flex-col">
                    <span className="text-[15px] font-medium truncate">{tag.name}</span>
                    <span className="text-xs text-muted-foreground">{torrentCount(tag.torrents)}</span>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      className="-mr-2 p-2 min-h-[44px] min-w-[44px] shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-accent active:bg-accent/80 transition-colors"
                      onClick={() => { setConfirmDelete(tag); setConfirmOpen(true); }}
                      aria-label={`Delete ${tag.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </GroupedSection>

            {canManage && (
              <form onSubmit={create}>
                <GroupedSection
                  title="New Tag"
                  footer={createError
                    ? <p id="tag-name-error" role="alert" className="text-destructive">{createError}</p>
                    : 'Up to 100 characters, without commas.'}
                >
                  <div className="grouped-row gap-2">
                    <Input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setCreateError(null);
                      }}
                      placeholder="Tag name"
                      aria-label="Tag name"
                      aria-invalid={createError ? true : undefined}
                      aria-describedby={createError ? 'tag-name-error' : undefined}
                      maxLength={100}
                      disabled={creating}
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                    <Button type="submit" variant="outline" className="h-11 shrink-0" disabled={creating || !name.trim()}>
                      {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                      Add
                    </Button>
                  </div>
                </GroupedSection>
              </form>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => { if (!open && !deleting) setConfirmOpen(false); }}
        title={confirmDelete ? `Delete ${confirmDelete.name}?` : 'Delete tag?'}
        description={confirmDelete && (confirmDelete.torrents > 0
          ? `It is removed from ${torrentCount(confirmDelete.torrents)}. The torrents and their files stay.`
          : 'No torrent has this tag.')}
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={remove}
      />
    </div>
  );
}
