'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
  DrawerDescription, DrawerFooter, DrawerClose,
} from '@/components/ui/drawer';
import { ApiError } from '@/lib/query-fetch';
import { endSessionInThisBrowser } from '@/lib/client-cache';

/**
 * Delete the signed-in user's own account. A local account confirms with its
 * password; a Jellyfin-only account, which has none, types its username.
 */
export function DeleteAccountDrawer({
  open,
  onOpenChange,
  username,
  hasLocalPassword,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;
  hasLocalPassword: boolean;
}) {
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hasLocalPassword ? { currentPassword: confirmation } : { confirmUsername: confirmation }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new ApiError(res.status, data.error ?? 'Failed to delete your account');
    },
    // The account and its sessions are gone: leave for Login in every tab.
    onSuccess: () => endSessionInThisBrowser(),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to delete your account'),
  });

  const canSubmit = confirmation.trim().length > 0
    && (hasLocalPassword || confirmation.trim() === username)
    && !mutation.isPending;

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (!o && mutation.isPending) return;
        if (!o) {
          setConfirmation('');
          setError(null);
        }
        onOpenChange(o);
      }}
    >
      <DrawerContent>
        <DrawerHeader className="text-center">
          <DrawerTitle>Delete my account</DrawerTitle>
          <DrawerDescription>
            This removes your account, watchlist, alerts, layouts, notification history and devices
            from Helprr, and signs you out everywhere. It can’t be undone.
          </DrawerDescription>
        </DrawerHeader>
        <form
          className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 space-y-2">
            {hasLocalPassword && (
              <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
            )}
            <Label htmlFor="da-confirm">
              {hasLocalPassword ? 'Current password' : `Type ${username} to confirm`}
            </Label>
            <Input
              id="da-confirm"
              type={hasLocalPassword ? 'password' : 'text'}
              autoComplete={hasLocalPassword ? 'current-password' : 'off'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={confirmation}
              onChange={(e) => {
                setConfirmation(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'da-error' : undefined}
            />
            {error && <p id="da-error" role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          <DrawerFooter>
            <Button type="submit" variant="destructive" disabled={!canSubmit} className="w-full">
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete my account
            </Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline" className="w-full" disabled={mutation.isPending}>Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
