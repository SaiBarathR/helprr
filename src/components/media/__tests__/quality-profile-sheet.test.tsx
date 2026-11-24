// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityProfileSummary } from '@/types';

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div role="dialog">{children}</div> : null),
  DrawerContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DrawerFooter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DrawerClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { QualityProfileSheet, QualityProfileValue } from '@/components/media/quality-profile-sheet';

const PROFILE: QualityProfileSummary = {
  id: 4,
  name: 'HD-1080p',
  upgradeAllowed: true,
  cutoff: 'WEB 1080p',
  qualities: [
    { name: 'Bluray-1080p', isCutoff: false, members: [] },
    { name: 'WEB 1080p', isCutoff: true, members: ['WEBDL-1080p', 'WEBRip-1080p'] },
  ],
  minFormatScore: 0,
  cutoffFormatScore: 1000,
  minUpgradeFormatScore: 10,
  language: 'English',
  formats: [{ name: 'AMZN', score: 50 }, { name: 'BR-DISK', score: -10000 }, { name: 'x265', score: 0 }],
};

let requested: string[];
let reply: () => Response;
beforeEach(() => {
  requested = [];
  reply = () => Response.json(PROFILE);
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    requested.push(input);
    return reply();
  }));
});

function Harness({ service = 'radarr' as const }: { service?: 'radarr' | 'sonarr' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <QualityProfileValue name="HD-1080p" onOpen={() => setOpen(true)} />
      <QualityProfileSheet service={service} instanceId="rad-1" profileId={4} profileName="HD-1080p" open={open} onOpenChange={setOpen} />
    </>
  );
}

function renderHarness(service?: 'radarr' | 'sonarr') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Harness service={service} /></QueryClientProvider>);
}

describe('QualityProfileSheet', () => {
  it('reads nothing and says so for a title without a profile', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <QualityProfileSheet service="sonarr" profileId={undefined} open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('This title has no quality profile.')).toBeTruthy();
    expect(requested).toEqual([]);
  });

  it('reads nothing until the profile name is tapped, then shows the profile from its instance', async () => {
    renderHarness();
    expect(requested).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Quality profile: HD-1080p' }));

    const dialog = await screen.findByRole('dialog');
    expect(requested).toEqual(['/api/radarr/qualityprofiles/4?instanceId=rad-1']);
    await within(dialog).findByText('Bluray-1080p');
    expect(within(dialog).getByText('Quality profile, as set in Radarr.')).toBeTruthy();
    expect(within(dialog).getByText('Upgrade until').nextSibling?.textContent).toBe('WEB 1080p');
    expect(within(dialog).getByText('English')).toBeTruthy();
    expect(within(dialog).getByText('Upgrade until score').nextSibling?.textContent).toBe('+1000');
    expect(within(dialog).getByText('Minimum score increase').nextSibling?.textContent).toBe('+10');
    expect(within(dialog).getByText('WEBDL-1080p, WEBRip-1080p')).toBeTruthy();
    expect(within(dialog).getAllByText('Cutoff')).toHaveLength(1);
    expect(within(dialog).getByText('AMZN').nextSibling?.textContent).toBe('+50');
    expect(within(dialog).getByText('BR-DISK').nextSibling?.textContent).toBe('-10000');
  });

  it('hides the cutoff and upgrade scores when the profile does not upgrade', async () => {
    reply = () => Response.json({ ...PROFILE, upgradeAllowed: false });
    renderHarness();
    await userEvent.click(screen.getByRole('button', { name: /HD-1080p/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Bluray-1080p');
    expect(within(dialog).getByText('Off')).toBeTruthy();
    expect(within(dialog).queryByText('Upgrade until')).toBeNull();
    expect(within(dialog).queryByText('Upgrade until score')).toBeNull();
    expect(within(dialog).queryByText('Cutoff')).toBeNull();
  });

  it('says when the instance has no custom formats, and leaves the score rows out', async () => {
    reply = () => Response.json({ ...PROFILE, language: null, formats: [] });
    renderHarness('sonarr');
    await userEvent.click(screen.getByRole('button', { name: /HD-1080p/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('No custom formats on this instance.')).toBeTruthy();
    expect(within(dialog).queryByText('Minimum format score')).toBeNull();
    expect(within(dialog).queryByText('Language')).toBeNull();
    expect(requested).toEqual(['/api/sonarr/qualityprofiles/4?instanceId=rad-1']);
  });

  it('says so when the app cannot be read', async () => {
    reply = () => Response.json({ error: 'Failed to fetch quality profile' }, { status: 500 });
    renderHarness();
    await userEvent.click(screen.getByRole('button', { name: /HD-1080p/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Could not read this profile from Radarr.')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'HD-1080p' })).toBeTruthy();
  });
});
