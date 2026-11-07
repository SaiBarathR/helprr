// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Drawer: ({ open, children }: { open: boolean; children?: ReactNode }) => (open ? <div>{children}</div> : null),
    DrawerContent: Pass, DrawerHeader: Pass, DrawerTitle: Pass, DrawerDescription: Pass, DrawerFooter: Pass, DrawerClose: Pass,
  };
});

import { TwoFactorSection } from './two-factor-section';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const CODES = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-DDD${String.fromCharCode(65 + i)}`);

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><TwoFactorSection /></QueryClientProvider>);
}

const fetchMock = vi.fn();
let status = { available: true, enabled: false, recoveryCodesLeft: 0 };

beforeEach(() => {
  status = { available: true, enabled: false, recoveryCodesLeft: 0 };
  fetchMock.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/me/totp' && !init?.method) return Response.json(status);
    if (url === '/api/me/totp/setup') return Response.json({ secret: SECRET, uri: `otpauth://totp/Helprr:alex?secret=${SECRET}` });
    if (url === '/api/me/totp/enable') {
      status = { available: true, enabled: true, recoveryCodesLeft: 10 };
      return Response.json({ recoveryCodes: CODES });
    }
    if (url === '/api/me/totp' && init?.method === 'DELETE') {
      return Response.json({ error: 'That code didn’t work. Try again.', field: 'code' }, { status: 403 });
    }
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('TwoFactorSection', () => {
  it('turns on after the password and a code, then shows the recovery codes once', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: /Authenticator app/ }));

    await user.type(screen.getByLabelText('Current password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([u]) => u === '/api/me/totp/setup')![1].body)))
      .toEqual({ currentPassword: 'correct horse battery' });

    expect(await screen.findByRole('img', { name: 'QR code for your authenticator app' })).toBeTruthy();
    expect((screen.getByLabelText('Or enter this key') as HTMLInputElement).value).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
    await user.type(screen.getByLabelText('Code from the app'), '123456');
    await user.click(screen.getByRole('button', { name: 'Turn on' }));

    const list = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(list.querySelectorAll('li')).toHaveLength(10);
    expect(screen.queryByRole('img', { name: 'QR code for your authenticator app' })).toBeNull();
    await waitFor(() => expect(screen.getByText(/10 recovery codes left/)).toBeTruthy());
  });

  it('turning off shows a wrong code against the code field', async () => {
    status = { available: true, enabled: true, recoveryCodesLeft: 9 };
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: /Authenticator app/ }));
    await user.type(screen.getByLabelText('Current password'), 'correct horse battery');
    await user.type(screen.getByLabelText('Code from your app, or a recovery code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Turn off' }));

    expect((await screen.findByRole('alert')).id).toBe('tf-off-code-error');
  });

  it('shows nothing for an account without a Helprr password', async () => {
    status = { available: false, enabled: false, recoveryCodesLeft: 0 };
    const { container } = renderSection();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
