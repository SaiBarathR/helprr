// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SettingsLayout from './layout';

describe('SettingsLayout', () => {
  it('keeps every settings page in the readable-width column', () => {
    render(<SettingsLayout><p>Service status</p></SettingsLayout>);

    expect(screen.getByText('Service status').parentElement?.className).toContain('readable-column');
  });

  it('lets a page that marks itself data-settings-wide take the full content width', () => {
    render(<SettingsLayout><div data-settings-wide>Theme</div></SettingsLayout>);

    expect(screen.getByText('Theme').parentElement?.className).toContain('[&:has(>[data-settings-wide])]:max-w-none');
  });
});
