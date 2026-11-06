// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

import { CreatorPlatformProvider } from './platform';
import { CreatorSubNav } from './subnav';

describe('CreatorSubNav', () => {
  it('keeps every section 44px wide and 44px tall to tap, labelled or not', () => {
    render(<CreatorPlatformProvider platform="youtube"><CreatorSubNav active="feed" /></CreatorPlatformProvider>);
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) {
      expect(link.className.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'min-w-11', 'touch-target-y']));
    }
  });
});
