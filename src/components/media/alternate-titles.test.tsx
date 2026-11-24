// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AlternateTitlesRow } from './alternate-titles';

describe('AlternateTitlesRow', () => {
  it("names a Sonarr scene title's season, and shows nothing without titles", async () => {
    const { container, rerender } = render(<AlternateTitlesRow titles={[]} />);
    expect(container.textContent).toBe('');
    rerender(<AlternateTitlesRow titles={undefined} />);
    expect(container.textContent).toBe('');

    // Captured from a real Sonarr 4 (The Apothecary Diaries).
    rerender(<AlternateTitlesRow titles={[
      { title: 'Kusuriya no Hitorigoto', sceneSeasonNumber: -1 },
      { title: 'Kusuriya no Hitorigoto S2', sceneSeasonNumber: 2 },
      { title: 'Die Tagebuecher der Apothekerin', seasonNumber: -1 },
      { title: '  ' },
    ]} />);
    const row = screen.getByRole('button', { name: /Alternative titles/ });
    expect(row.textContent).toContain('3');
    await userEvent.setup().click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Kusuriya no Hitorigoto',
      'Kusuriya no Hitorigoto S2 · Season 2',
      'Die Tagebuecher der Apothekerin',
    ]);
  });
});
