import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('next/image', () => ({ default: () => null }));

import { ShareResolutionView } from './share-resolution-view';

const resolved = {
  kind: 'tmdb' as const,
  hit: { tmdbId: 550, mediaType: 'movie' as const, title: 'Fight Club', year: 1999, posterPath: null, overview: '' },
};

describe('ShareResolutionView title link', () => {
  it('links to the title page for a member who may open it', () => {
    const html = renderToStaticMarkup(
      <ShareResolutionView resolved={resolved as never} input={{}} canOpenTitle />,
    );
    expect(html).toContain('href="/discover/movie/550"');
  });

  it('leaves the link out for a member who may not', () => {
    const html = renderToStaticMarkup(
      <ShareResolutionView resolved={resolved as never} input={{}} canOpenTitle={false} />,
    );
    expect(html).not.toContain('/discover/movie/550');
    expect(html).toContain('Fight Club');
  });
});
