'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
  DrawerDescription, DrawerFooter, DrawerClose,
} from '@/components/ui/drawer';
import { ApiError } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { LOCAL_PASSWORD_MIN_LENGTH, localPasswordValidationError } from '@/lib/password-policy';

/** Change the signed-in user's own Helprr password. Other devices are signed out. */
export function ChangePasswordDrawer({
  open,
  onOpenChange,
  username,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string;
}) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const nextError = next ? localPasswordValidationError(next) : null;
  const confirmError = confirm && confirm !== next ? 'Passwords don’t match' : null;

  function reset() {
    setCurrent('');
    setNext('');
    setConfirm('');
    setCurrentError(null);
    setFormError(null);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; revokedSessions?: number };
      // A 401 means this session ended; the global mutation handler sends it to Login.
      if (!res.ok) throw new ApiError(res.status, data.error ?? 'Failed to change password');
      return data;
    },
    onSuccess: (data) => {
      const others = data.revokedSessions ?? 0;
      toast.success(
        others > 0
          ? `Password changed. Signed out ${others} other session${others === 1 ? '' : 's'}.`
          : 'Password changed',
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
      reset();
      onOpenChange(false);
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : 'Failed to change password';
      if (error instanceof ApiError && error.status === 403) setCurrentError(message);
      else setFormError(message);
    },
  });

  const canSubmit = Boolean(current && next && confirm) && !nextError && !confirmError && !mutation.isPending;

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        // Stay open until the answer arrives, so its result is never shown on a later open.
        if (!o && mutation.isPending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DrawerContent size="content">
        <DrawerHeader className="text-center">
          <DrawerTitle>Change password</DrawerTitle>
          <DrawerDescription>Your other devices will be signed out. This one stays signed in.</DrawerDescription>
        </DrawerHeader>
        <form
          className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            setCurrentError(null);
            setFormError(null);
            mutation.mutate();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 space-y-4">
            {/* Lets a password manager file the new password under the right account. */}
            <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
            <div className="space-y-2">
              <Label htmlFor="cp-current">Current password</Label>
              <Input
                id="cp-current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => {
                  setCurrent(e.target.value);
                  setCurrentError(null);
                  setFormError(null);
                }}
                aria-invalid={currentError ? true : undefined}
                aria-describedby={currentError ? 'cp-current-error' : undefined}
              />
              {currentError && (
                <p id="cp-current-error" role="alert" className="text-xs text-destructive">{currentError}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cp-new">New password</Label>
              <Input
                id="cp-new"
                type="password"
                autoComplete="new-password"
                minLength={LOCAL_PASSWORD_MIN_LENGTH}
                value={next}
                onChange={(e) => {
                  setNext(e.target.value);
                  setFormError(null);
                }}
                aria-invalid={nextError ? true : undefined}
                aria-describedby="cp-new-hint"
              />
              <p id="cp-new-hint" className={nextError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {nextError ?? `Use at least ${LOCAL_PASSWORD_MIN_LENGTH} characters.`}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cp-confirm">Confirm new password</Label>
              <Input
                id="cp-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setFormError(null);
                }}
                aria-invalid={confirmError ? true : undefined}
                aria-describedby={confirmError ? 'cp-confirm-error' : undefined}
              />
              {confirmError && <p id="cp-confirm-error" className="text-xs text-destructive">{confirmError}</p>}
            </div>
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          </div>
          <DrawerFooter>
            <Button type="submit" disabled={!canSubmit} className="w-full">
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Change password
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
