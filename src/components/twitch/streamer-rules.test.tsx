// @vitest-environment jsdom

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuleLayerValue } from './policy-editor';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/floating-action-bar', () => ({
  FloatingActionBar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { StreamerRules } from './streamer-rules';

function Harness() {
  const [draft, setDraft] = useState<RuleLayerValue | null>(null);
  return <StreamerRules streamerId="streamer-1" draft={draft} setDraft={setDraft} />;
}

function renderRules() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
}

describe('StreamerRules', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps an edit made while a save is running', async () => {
    let finishSave: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => (init?.method === 'PUT'
      ? new Promise<Response>((resolve) => { finishSave = resolve; })
      : Promise.resolve(new Response(JSON.stringify({ defaultPolicy: {}, typePolicies: {}, streamer: null })))));
    vi.stubGlobal('fetch', fetchMock);
    renderRules();

    await userEvent.type(await screen.findByRole('spinbutton', { name: 'Longer than' }), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Shorter than' }), '9');
    finishSave(new Response('{}'));

    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false));
    expect(screen.getByRole('spinbutton', { name: 'Shorter than' })).toHaveProperty('value', '9');
    expect(screen.getByRole('spinbutton', { name: 'Longer than' })).toHaveProperty('value', '5');
  });

  it('clears the save bar when nothing changed during the save', async () => {
    let streamer: unknown = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const { policy, typePolicies } = JSON.parse(String(init.body));
        streamer = { policy, typePolicies };
        return new Response('{}');
      }
      return new Response(JSON.stringify({ defaultPolicy: {}, typePolicies: {}, streamer }));
    }));
    renderRules();

    await userEvent.type(await screen.findByRole('spinbutton', { name: 'Longer than' }), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(screen.getByRole('spinbutton', { name: 'Longer than' })).toHaveProperty('value', '5');
  });
});
