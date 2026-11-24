import { redirect } from 'next/navigation';
import { resolveSharedInput } from '@/lib/share/resolve-shared-input';
import { sharedTorrentLinks } from '@/lib/share/torrent-links';
import { ShareResolutionView } from '@/components/share/share-resolution-view';
import { getCurrentUser } from '@/lib/auth';
import { TMDB_TITLE_PAGE_CAPABILITIES } from '@/lib/capabilities';
import { can } from '@/lib/permissions';

interface SharePageProps {
  searchParams: Promise<{
    title?: string;
    text?: string;
    url?: string;
  }>;
}

export const dynamic = 'force-dynamic';

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const user = await getCurrentUser();
  // A magnet or .torrent link opens Torrents -> Add with it, for whoever may add
  // torrents; everyone else gets the title resolution below as before.
  const torrentLinks = user && can(user, 'torrents.add') ? sharedTorrentLinks(params) : [];
  if (torrentLinks.length > 0) redirect(`/torrents/add?links=${encodeURIComponent(torrentLinks.join('\n'))}`);
  // Links only show for pages the member may open.
  const canOpenTitle = Boolean(user && TMDB_TITLE_PAGE_CAPABILITIES.some((cap) => can(user, cap)));
  const canOpenDiscover = Boolean(user && can(user, 'discover.view'));
  const resolved = await resolveSharedInput({
    title: params.title ?? null,
    text: params.text ?? null,
    url: params.url ?? null,
  });

  return (
    <div className="mx-auto w-full max-w-2xl animate-content-in pb-16">
      <ShareResolutionView resolved={resolved} input={params} canOpenTitle={canOpenTitle} canOpenDiscover={canOpenDiscover} />
    </div>
  );
}
