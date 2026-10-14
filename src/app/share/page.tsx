import { resolveSharedInput } from '@/lib/share/resolve-shared-input';
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
  // The title page link only shows when the member may open title pages.
  const canOpenTitle = Boolean(user && TMDB_TITLE_PAGE_CAPABILITIES.some((cap) => can(user, cap)));
  const resolved = await resolveSharedInput({
    title: params.title ?? null,
    text: params.text ?? null,
    url: params.url ?? null,
  });

  return (
    <div className="mx-auto w-full max-w-2xl animate-content-in pb-16">
      <ShareResolutionView resolved={resolved} input={params} canOpenTitle={canOpenTitle} />
    </div>
  );
}
