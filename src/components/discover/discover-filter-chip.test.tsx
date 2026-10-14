import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ canDiscover: true }));

vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/permission-provider', () => ({
  useCan: (cap: string) => cap === 'discover.view' && mocks.canDiscover,
}));

import { DiscoverFilterChip } from './discover-filter-chip';

describe('DiscoverFilterChip', () => {
  it('links to the filtered Discover home for a member with discover.view', () => {
    mocks.canDiscover = true;
    const html = renderToStaticMarkup(<DiscoverFilterChip href="/discover?networks=49">HBO</DiscoverFilterChip>);
    expect(html).toContain('href="/discover?networks=49"');
  });

  it('shows plain text to a member without it', () => {
    mocks.canDiscover = false;
    const html = renderToStaticMarkup(<DiscoverFilterChip href="/discover?networks=49">HBO</DiscoverFilterChip>);
    expect(html).toBe('<span>HBO</span>');
  });
});
