'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
  DrawerDescription, DrawerFooter, DrawerClose,
} from '@/components/ui/drawer';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { ACCOUNT_DELETED_KEY, endSessionInThisBrowser } from '@/lib/client-cache';

/**
 * Delete the signed-in user's own account. A local account confirms with its
 * password; a Jellyfin-only account, which has none, with its Jellyfin password.
 * With two-step sign-in on, also a code from the app or a recovery code.
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
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const twoStep = useQuery({
    queryKey: queryKeys.twoFactor(),
    queryFn: jsonFetcher<{ enabled: boolean }>('/api/me/totp'),
    enabled: open,
  });
  // The server's answer wins over the cached status (two-step may have just changed).
  const [serverNeedsCode, setServerNeedsCode] = useState(false);
  const needsCode = serverNeedsCode || twoStep.data?.enabled === true;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: confirmation, ...(needsCode ? { code: code.trim() } : {}) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; needsCode?: boolean };
      if (data.needsCode === true) setServerNeedsCode(true);
      if (!res.ok) throw new ApiError(res.status, data.error ?? 'Failed to delete your account');
    },
    // The account and its sessions are gone: leave for Login in every tab,
    // which then says so instead of looking like a plain sign-out.
    onSuccess: () => {
      try {
        sessionStorage.setItem(ACCOUNT_DELETED_KEY, '1');
      } catch {
        // Private mode: Login just shows its usual line.
      }
      endSessionInThisBrowser();
    },
    onError: (err) => {
      // A code that passed is used up even when the delete was then refused.
      setCode('');
      setError(err instanceof ApiError ? err.message : 'Failed to delete your account');
    },
  });

  const canSubmit = confirmation.trim().length > 0
    && (!needsCode || code.trim().length > 0)
    && !twoStep.isPending
    && !mutation.isPending;

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (!o && mutation.isPending) return;
        if (!o) {
          setConfirmation('');
          setCode('');
          setServerNeedsCode(false);
          setError(null);
        }
        onOpenChange(o);
      }}
    >
      <DrawerContent size="content" scrollTogether>
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
              {hasLocalPassword ? 'Current password' : 'Jellyfin password'}
            </Label>
            <Input
              id="da-confirm"
              type="password"
              autoComplete="current-password"
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
            {needsCode && (
              <>
                <Label htmlFor="da-code" className="pt-2">Code from your app, or a recovery code</Label>
                <Input
                  id="da-code"
                  type="text"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={24}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setError(null);
                  }}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'da-error' : undefined}
                />
              </>
            )}
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
