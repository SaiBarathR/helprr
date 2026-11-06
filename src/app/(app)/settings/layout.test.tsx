// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SettingsLayout from './layout';

describe('SettingsLayout', () => {
  it('keeps every settings page in the readable-width column', () => {
    render(<SettingsLayout><p>Service status</p></SettingsLayout>);

    expect(screen.getByText('Service status').parentElement?.className).toBe('readable-column');
  });
});
