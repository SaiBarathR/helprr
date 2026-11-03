'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ChevronUp, Loader2 } from 'lucide-react';
import Link from '@/components/ui/app-link';
import { formatBytes } from '@/lib/format';
import { CreatorAvatar } from './creator-avatar';
import { FileRow } from './file-row';
import type { ArchiveFile, FileGroup } from './file-types';
import { useCreatorPlatform } from './platform';
import type { FileActions } from './use-file-actions';

interface FilePage {
  files: ArchiveFile[];
  total: number;
  page: number;
  pageSize: number;
}

const ALL_PAGE_SIZE = 30;
const BUTTON = 'flex min-h-11 w-full items-center justify-center gap-1 text-sm text-primary active:bg-foreground/5 disabled:opacity-60';

/** One channel: its header, its newest files as Library rows, and the rest opened in place. */
function FileGroupSection({ group, params, actions, cleanupDue }: {
  group: FileGroup;
  params: string;
  actions: FileActions;
  cleanupDue: Set<string>;
}) {
  const platform = useCreatorPlatform();
  const [open, setOpen] = useState(false);
  const { creator, total, totalBytes } = group;
  const scope = new URLSearchParams(params);
  scope.set('streamer', creator.id);
  scope.set('pageSize', String(ALL_PAGE_SIZE));
  // Under 'files', so keep forever and refreshes reach these rows as they reach the list.
  const all = useInfiniteQuery({
    queryKey: [platform.id, 'files', scope.toString()],
    queryFn: async ({ pageParam, signal }) => {
      const res = await fetch(`${platform.api}/files?${scope}&page=${pageParam}`, { signal });
      if (!res.ok) throw new Error('Failed to load the library');
      return (await res.json()) as FilePage;
    },
    initialPageParam: 1,
    getNextPageParam: (last: FilePage) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    refetchInterval: (query) => (query.state.data?.pages.some((page) => page.files.some((file) => file.activeJob)) ? 3_000 : false),
    refetchIntervalInBackground: false,
    enabled: open,
  });
  const files = open && all.data ? all.data.pages.flatMap((page) => page.files) : group.files;
  const more = total > group.files.length;

  return (
    <section aria-label={creator.displayName}>
      <Link href={`${platform.creatorsPath}/${creator.id}`} className="press-feedback mb-2 flex min-h-11 items-center gap-2.5 px-1">
        <CreatorAvatar url={creator.profileImageUrl} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold leading-tight">{creator.displayName}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {total} {total === 1 ? 'video' : 'videos'} · {formatBytes(totalBytes)}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
        {files.map((file) => <FileRow key={file.id} file={file} actions={actions} cleanupDue={cleanupDue.has(file.id)} showCreator={false} />)}
        {open && all.hasNextPage && (
          <button type="button" className={BUTTON} disabled={all.isFetchingNextPage} onClick={() => void all.fetchNextPage()}>
            {all.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
            Show more
          </button>
        )}
        {more && (
          <button type="button" aria-expanded={open} className={BUTTON} disabled={open && all.isLoading} onClick={() => setOpen((value) => !value)}>
            {open && all.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {open ? <>Show less<ChevronUp className="h-4 w-4" /></> : <>Show all {total}<ChevronDown className="h-4 w-4" /></>}
          </button>
        )}
      </div>
    </section>
  );
}

/** The Library by channel. The order follows the Library's sort. */
export function FileGroups({ groups, params, actions, cleanupDue }: {
  groups: FileGroup[];
  params: string;
  actions: FileActions;
  cleanupDue: Set<string>;
}) {
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <FileGroupSection key={group.creator.id} group={group} params={params} actions={actions} cleanupDue={cleanupDue} />
      ))}
    </div>
  );
}
