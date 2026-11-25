'use client';

import { PageHeader } from '@/components/layout/page-header';
import { useAppRouter } from '@/components/layout/navigation-provider';
import { PageSpinner } from '@/components/ui/page-spinner';
import { QbitGone } from '../_components/qbit-gone';
import { useQbitInstance } from '../_components/use-qbit-instance';

/**
 * Every per-torrent page reads `?instance=`. A push sent before its qBittorrent
 * was removed still names it: the routes refuse that id, so say so here rather
 * than a Retry that can never work. Show opens that qBittorrent's list, not
 * this hash there (the same hash in another qBittorrent is another torrent).
 */
export default function TorrentPagesLayout({ children }: { children: React.ReactNode }) {
  const { unknownLink, checkingLink, instances } = useQbitInstance();
  const router = useAppRouter();
  // Until the list says whether it still exists, the page would ask for it and
  // flash the routes' refusal first.
  if (checkingLink) return <PageSpinner />;
  if (!unknownLink) return children;
  return (
    <div className="animate-content-in">
      <PageHeader title="Torrent" backHref="/torrents" />
      <div className="mt-3">
        <QbitGone instances={instances} onShow={(id) => router.replace(`/torrents?instance=${encodeURIComponent(id)}`)} />
      </div>
    </div>
  );
}
