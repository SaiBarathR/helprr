'use client';

import { useState } from 'react';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { useCan } from '@/components/permission-provider';
import { getOrganizeTargets } from '../_components/organize-targets';
import { TorrentLocationSection, TorrentQueueSection, TorrentTagsSection } from '../_components/torrent-organize-sections';
import { parseTorrentTags } from '../_components/torrent-tags';

const TITLE = 'Location, Tags & Queue';
const SHOWN_NAMES = 5;

/** Moves, tags and queues the torrents selected on the list, all at once. */
export default function OrganizeTorrentsPage() {
  const router = useRouter();
  const canManage = useCan('torrents.manage');
  const [targets, setTargets] = useState(() =>
    getOrganizeTargets().map((t) => ({ ...t, tags: parseTorrentTags(t.tags) })),
  );
  const count = targets.length;
  const hash = targets.map((t) => t.hash).join('|');
  const savePath = targets.every((t) => t.save_path === targets[0]?.save_path) ? (targets[0]?.save_path ?? '') : null;

  if (!canManage) {
    return (
      <>
        <PageHeader title={TITLE} />
        <p className="py-16 text-center text-sm text-muted-foreground">
          You don&apos;t have permission to change torrents.
        </p>
      </>
    );
  }

  if (count === 0) {
    return (
      <>
        <PageHeader title={TITLE} />
        <div className="py-16 text-center">
          <p className="text-sm text-muted-foreground">No torrents selected.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push('/torrents')}>
            Choose torrents
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="animate-content-in">
      <PageHeader title={TITLE} subtitle={`${count} ${count === 1 ? 'torrent' : 'torrents'}`} />

      <div className="mt-3 pb-8">
        <TorrentLocationSection
          hash={hash}
          savePath={savePath}
          onSaved={(location) => setTargets((prev) => prev.map((t) => ({ ...t, save_path: location })))}
        />
        <TorrentTagsSection
          hash={hash}
          tagsByTorrent={targets.map((t) => t.tags)}
          onChanged={(action, tag) =>
            setTargets((prev) =>
              prev.map((t) => ({
                ...t,
                tags: action === 'addTags' ? [...new Set([...t.tags, tag])] : t.tags.filter((x) => x !== tag),
              })),
            )
          }
        />
        <TorrentQueueSection hash={hash} />

        <GroupedSection title={count === 1 ? 'Torrent' : 'Torrents'}>
          {targets.slice(0, SHOWN_NAMES).map((target) => (
            <div key={target.hash} className="grouped-row">
              <span className="text-sm truncate min-w-0">{target.name}</span>
            </div>
          ))}
          {count > SHOWN_NAMES && (
            <div className="grouped-row">
              <span className="text-sm text-muted-foreground">and {count - SHOWN_NAMES} more</span>
            </div>
          )}
        </GroupedSection>
      </div>
    </div>
  );
}
