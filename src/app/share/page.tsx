import { resolveSharedInput } from '@/lib/share/resolve-shared-input';
import { ShareResolutionView } from '@/components/share/share-resolution-view';

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
  const resolved = await resolveSharedInput({
    title: params.title ?? null,
    text: params.text ?? null,
    url: params.url ?? null,
  });

  return (
    <div className="animate-content-in pb-16">
      <ShareResolutionView resolved={resolved} input={params} />
    </div>
  );
}
