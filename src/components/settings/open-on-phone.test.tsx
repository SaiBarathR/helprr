// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/drawer', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Drawer: Pass, DrawerClose: Pass, DrawerContent: Pass, DrawerDescription: Pass, DrawerFooter: Pass, DrawerHeader: Pass, DrawerTitle: Pass };
});

import { OpenOnPhoneDrawer } from './open-on-phone';

// jsdom's location cannot be redefined; stub the origin the drawer reads.
function at(origin: string) {
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, origin } as Location);
}
afterEach(() => vi.restoreAllMocks());

describe('OpenOnPhoneDrawer', () => {
  it('shows a code and both install guides for an https address', () => {
    at('https://helprr.example.com');
    render(<OpenOnPhoneDrawer open onOpenChange={() => {}} />);
    expect(screen.getByRole('img', { name: 'QR code for https://helprr.example.com' })).toBeTruthy();
    expect(screen.getByText('iPhone and iPad')).toBeTruthy();
    expect(screen.getByText('Android')).toBeTruthy();
    expect(screen.queryByText(/same network/)).toBeNull();
  });

  it('says the phone must share the network, and push needs HTTPS, for a home address', () => {
    at('http://192.168.1.10:3050');
    render(<OpenOnPhoneDrawer open onOpenChange={() => {}} />);
    expect(screen.getByRole('img', { name: 'QR code for http://192.168.1.10:3050' })).toBeTruthy();
    expect(screen.getByText(/must be on the same network/)).toBeTruthy();
  });

  it('shows no code for this computer\'s own address', () => {
    at('http://localhost:3050');
    render(<OpenOnPhoneDrawer open onOpenChange={() => {}} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.body.textContent).toContain('This address only works on this computer.');
    expect(document.body.textContent).toContain("Open Helprr in this browser at this computer's address on your network");
  });
});
