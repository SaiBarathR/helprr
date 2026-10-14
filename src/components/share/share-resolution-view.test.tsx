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
      <ShareResolutionView resolved={resolved as never} input={{}} canOpenTitle canOpenDiscover />,
    );
    expect(html).toContain('href="/discover/movie/550"');
  });

  it('leaves the link out for a member who may not', () => {
    const html = renderToStaticMarkup(
      <ShareResolutionView resolved={resolved as never} input={{}} canOpenTitle={false} canOpenDiscover={false} />,
    );
    expect(html).not.toContain('/discover/movie/550');
    expect(html).toContain('Fight Club');
  });

  it('offers the Discover search fallback only to a member with discover.view', () => {
    const query = { kind: 'query' as const, query: 'some show' };
    const allowed = renderToStaticMarkup(
      <ShareResolutionView resolved={query as never} input={{}} canOpenTitle canOpenDiscover />,
    );
    const denied = renderToStaticMarkup(
      <ShareResolutionView resolved={query as never} input={{}} canOpenTitle canOpenDiscover={false} />,
    );
    expect(allowed).toContain('href="/discover?q=some%20show"');
    expect(denied).not.toContain('/discover');
  });

  it('offers Open Discover for unknown input only to a member with discover.view', () => {
    const unknown = { kind: 'unknown' as const };
    const denied = renderToStaticMarkup(
      <ShareResolutionView resolved={unknown as never} input={{}} canOpenTitle canOpenDiscover={false} />,
    );
    expect(denied).not.toContain('href="/discover"');
  });
});
