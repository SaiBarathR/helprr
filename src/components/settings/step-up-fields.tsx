'use client';

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';

/**
 * A refusal of the password or code. It is shown under those fields, not in a
 * toast: on a phone a toast sits over the dialog's button.
 */
export class StepUpRefusal extends Error {}

/** Whether a failed mutation was a step-up refusal already shown by StepUpFields. */
export function isStepUpRefusal(err: unknown): boolean {
  return err instanceof StepUpRefusal;
}

/**
 * What a step a session alone must not take needs from you (giving admin, a
 * way into another admin's account, importing users, changing Jellyfin): your
 * password, and a code while your two-step sign-in is on. `myTwoStep` is the
 * caller's copy of that; without one it is read from /api/me/totp.
 */
export function useStepUp(myTwoStep?: boolean) {
  const own = useQuery({
    queryKey: queryKeys.twoFactor(),
    queryFn: jsonFetcher<{ enabled: boolean }>('/api/me/totp'),
    enabled: myTwoStep === undefined,
  });
  const [currentPassword, setPassword] = useState('');
  const [code, setCodeValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The server's answer wins over the list's copy (it may be stale).
  const [serverNeedsCode, setServerNeedsCode] = useState<boolean | null>(null);
  const needsCode = serverNeedsCode ?? myTwoStep ?? own.data?.enabled === true;
  // Stable, so an effect can clear the fields when a dialog closes.
  const clear = useCallback(() => {
    setPassword('');
    setCodeValue('');
    setServerNeedsCode(null);
    setError(null);
  }, []);
  // Typing again takes the last refusal away.
  const setCurrentPassword = useCallback((value: string) => {
    setPassword(value);
    setError(null);
  }, []);
  const setCode = useCallback((value: string) => {
    setCodeValue(value);
    setError(null);
  }, []);
  return {
    currentPassword,
    setCurrentPassword,
    code,
    setCode,
    needsCode,
    /** Why the last password or code was refused, shown under the fields. */
    error,
    /** The server asked for them (the list's copy of a role may be stale). */
    asked: serverNeedsCode !== null,
    ready: currentPassword.length > 0 && (!needsCode || code.trim().length > 0),
    body: () => ({ currentPassword, ...(needsCode ? { code: code.trim() } : {}) }),
    /**
     * Reads a refusal: the server may ask for these. The code goes either way:
     * one that passed is used up, even when a later step failed. True when it
     * was about the password or code (then shown under the fields: throw a
     * StepUpRefusal and skip the toast).
     */
    onRefused: (
      data: { error?: string; field?: string; needsStepUp?: boolean; needsCode?: boolean },
      status?: number,
    ): boolean => {
      if (data.needsStepUp === true && typeof data.needsCode === 'boolean') setServerNeedsCode(data.needsCode);
      setCodeValue('');
      // A 429 is the sign-in throttle only when the password went with it (the
      // fields are on screen); otherwise it is someone else's, for the caller's toast.
      const aboutFactors = data.needsStepUp === true || data.field === 'currentPassword' || data.field === 'code'
        || (status === 429 && currentPassword.length > 0);
      if (aboutFactors) setError(data.error ?? 'That didn’t work. Try again.');
      return aboutFactors;
    },
    clear,
  };
}

export function StepUpFields({ stepUp, reason }: { stepUp: ReturnType<typeof useStepUp>; reason: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {reason} Confirm it is you with your password{stepUp.needsCode ? ' and a code' : ''}.
      </p>
      <Input
        type="password"
        aria-label="Your current password"
        placeholder="Your current password"
        autoComplete="current-password"
        value={stepUp.currentPassword}
        onChange={(e) => stepUp.setCurrentPassword(e.target.value)}
      />
      {stepUp.needsCode && (
        <Input
          type="text"
          aria-label="Authenticator or recovery code"
          placeholder="Code or recovery code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={24}
          value={stepUp.code}
          onChange={(e) => stepUp.setCode(e.target.value)}
        />
      )}
      {stepUp.error && <p role="alert" className="text-sm text-destructive">{stepUp.error}</p>}
    </div>
  );
}
