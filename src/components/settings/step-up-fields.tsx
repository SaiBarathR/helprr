'use client';

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';

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
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  // The server's answer wins over the list's copy (it may be stale).
  const [serverNeedsCode, setServerNeedsCode] = useState<boolean | null>(null);
  const needsCode = serverNeedsCode ?? myTwoStep ?? own.data?.enabled === true;
  // Stable, so an effect can clear the fields when a dialog closes.
  const clear = useCallback(() => {
    setCurrentPassword('');
    setCode('');
    setServerNeedsCode(null);
  }, []);
  return {
    currentPassword,
    setCurrentPassword,
    code,
    setCode,
    needsCode,
    /** The server asked for them (the list's copy of a role may be stale). */
    asked: serverNeedsCode !== null,
    ready: currentPassword.length > 0 && (!needsCode || code.trim().length > 0),
    body: () => ({ currentPassword, ...(needsCode ? { code: code.trim() } : {}) }),
    /**
     * Reads a refusal: the server may ask for these. The code goes either way:
     * one that passed is used up, even when a later step failed.
     */
    onRefused: (data: { needsStepUp?: boolean; needsCode?: boolean }) => {
      if (data.needsStepUp === true && typeof data.needsCode === 'boolean') setServerNeedsCode(data.needsCode);
      setCode('');
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
    </div>
  );
}
