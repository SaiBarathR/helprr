'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronRight, Copy, Download, Loader2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
  DrawerDescription, DrawerFooter, DrawerClose,
} from '@/components/ui/drawer';
import { GroupedSection } from '@/components/settings/grouped-section';
import { QrCode } from '@/components/settings/open-on-phone';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { saveFile } from '@/lib/save-file';

interface TwoFactorStatus {
  available: boolean;
  enabled: boolean;
  recoveryCodesLeft: number;
}

/** ApiError, plus which input the server blamed ("code"), when it said. */
class TwoFactorError extends ApiError {
  constructor(status: number, message: string, public field?: string) {
    super(status, message);
  }
}

async function postJson<T>(url: string, method: 'POST' | 'DELETE', body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; field?: string };
  // A 401 means this session ended; the global mutation handler sends it to Login.
  if (!res.ok) throw new TwoFactorError(res.status, data.error ?? fallback, data.field);
  return data;
}

/** Closes a phone keyboard by taking focus off the field typed in. */
function blurField() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/** "ABCD EFGH IJKL …": easier to type into an app by hand. */
function groupKey(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

/** Settings → Account: turn two-step sign-in (an authenticator app) on or off. Local accounts only. */
export function TwoFactorSection() {
  const status = useQuery({
    queryKey: queryKeys.twoFactor(),
    queryFn: jsonFetcher<TwoFactorStatus>('/api/me/totp'),
  });
  // Which drawer is open, fixed when it opens: turning it on refetches the
  // status, and the recovery codes must stay on screen when it flips to on.
  const [open, setOpen] = useState<'enable' | 'disable' | null>(null);

  if (!status.data?.available) return null;
  const { enabled, recoveryCodesLeft } = status.data;

  return (
    <>
      <GroupedSection
        title="Two-step sign-in"
        footer={enabled
          ? `Sign-in asks for a code from your authenticator app, with Jellyfin too. ${recoveryCodesLeft} recovery code${recoveryCodesLeft === 1 ? '' : 's'} left.`
          : 'Ask for a code from an authenticator app after your password.'}
      >
        <button
          type="button"
          onClick={() => setOpen(enabled ? 'disable' : 'enable')}
          className="grouped-row w-full text-left hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
        >
          <span className="text-sm font-medium">Authenticator app</span>
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            {enabled ? 'On' : 'Off'}
            <ChevronRight className="h-4 w-4" />
          </span>
        </button>
      </GroupedSection>
      <EnableTwoFactorDrawer open={open === 'enable'} onOpenChange={(o) => setOpen(o ? 'enable' : null)} />
      <DisableTwoFactorDrawer open={open === 'disable'} onOpenChange={(o) => setOpen(o ? 'disable' : null)} />
    </>
  );
}

function EnableTwoFactorDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Copied" shows on the button itself: a toast would sit over Copy and Download.
  const [copied, setCopied] = useState<'codes' | 'key' | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);
  // The error is under the fields at the end of a scrolling body: bring it into view.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);

  function reset() {
    setPassword('');
    setSetup(null);
    setCode('');
    setSignOutOthers(true);
    setRecoveryCodes(null);
    setError(null);
  }

  const start = useMutation({
    mutationFn: () => postJson<{ secret: string; uri: string }>(
      '/api/me/totp/setup', 'POST', { currentPassword: password }, 'Failed to start setup',
    ),
    onSuccess: (data) => {
      // The next step is a code to scan: close the phone keyboard rather than
      // leave it covering the QR code.
      blurField();
      setSetup(data);
      setPassword('');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to start setup'),
  });

  const confirm = useMutation({
    mutationFn: () => postJson<{ recoveryCodes: string[] }>(
      '/api/me/totp/enable', 'POST', { code, signOutOtherDevices: signOutOthers }, 'Failed to turn on two-step sign-in',
    ),
    onSuccess: (data) => {
      blurField();
      // No toast: the codes sheet says it is on, and a toast would sit over its Copy and Download.
      setRecoveryCodes(data.recoveryCodes);
      setSetup(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.twoFactor() });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to turn on two-step sign-in'),
  });

  const pending = start.isPending || confirm.isPending;
  // The authenticator shows 6 digits: Turn on waits for all of them (with 5 the
  // server could only say "That code didn't work").
  const codeComplete = /^\d{6}$/.test(code.replace(/\s/g, ''));

  async function copy(text: string, what: 'codes' | 'key') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error('Copy failed — select the text and copy it');
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (!o && pending) return;
        // The codes are shown once: only Done closes them, not a stray swipe.
        if (!o && recoveryCodes) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DrawerContent size="content" scrollTogether>
        <DrawerHeader className="text-center">
          <DrawerTitle>{recoveryCodes ? 'Save your recovery codes' : 'Turn on two-step sign-in'}</DrawerTitle>
          <DrawerDescription>
            {recoveryCodes
              ? 'Each code signs you in once if you lose your phone. They are shown only now.'
              : setup
                ? 'Scan the code with an authenticator app (1Password, Google Authenticator, Authy…), then enter the 6-digit code it shows.'
                : 'Confirm your password to start.'}
          </DrawerDescription>
        </DrawerHeader>
        <form
          className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (pending) return;
            setError(null);
            if (recoveryCodes) {
              reset();
              onOpenChange(false);
            } else if (setup) {
              if (codeComplete) confirm.mutate();
            } else if (password) {
              start.mutate();
            }
          }}
        >
          {/* Keyed by step, so each step starts at its top, not where the last one was scrolled. */}
          <div key={recoveryCodes ? 'codes' : setup ? 'scan' : 'password'} className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 space-y-4">
            {recoveryCodes ? (
              <>
                <ul className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 font-mono text-sm" aria-label="Recovery codes">
                  {recoveryCodes.map((c) => <li key={c} className="text-center">{c}</li>)}
                </ul>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => copy(recoveryCodes.join('\n'), 'codes')}>
                    {copied === 'codes' ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    <span aria-live="polite">{copied === 'codes' ? 'Copied' : 'Copy'}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      void saveFile(
                        new Blob([`Helprr recovery codes\n\n${recoveryCodes.join('\n')}\n`], { type: 'text/plain' }),
                        'helprr-recovery-codes.txt',
                      ).catch(() => toast.error('Failed to save the codes'));
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>
              </>
            ) : setup ? (
              <>
                <div className="flex flex-col items-center gap-2">
                  <QrCode text={setup.uri} label="QR code for your authenticator app" />
                  {/* On the phone itself there is nothing to scan: iOS opens Passwords or the app. */}
                  <a href={setup.uri} className="min-h-[44px] inline-flex items-center text-sm text-primary underline-offset-2 hover:underline">
                    Open in authenticator app
                  </a>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tf-key">Or enter this key</Label>
                  <div className="flex gap-2">
                    <Input
                      id="tf-key"
                      readOnly
                      value={groupKey(setup.secret)}
                      onFocus={(e) => e.currentTarget.select()}
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={copied === 'key' ? 'Key copied' : 'Copy key'}
                      onClick={() => copy(setup.secret, 'key')}
                    >
                      {copied === 'key' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tf-code">Code from the app</Label>
                  <Input
                    id="tf-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value);
                      setError(null);
                    }}
                  />
                </div>
                {/* Whoever may already be signed in elsewhere has to sign in again, with a code. */}
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3">
                  <Checkbox checked={signOutOthers} onCheckedChange={(v) => setSignOutOthers(v === true)} />
                  <span className="text-sm">Sign out your other devices</span>
                </label>
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="tf-password">Current password</Label>
                <Input
                  id="tf-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                />
              </div>
            )}
            {error && <p ref={errorRef} role="alert" className="text-sm text-destructive">{error}</p>}
          </div>
          <DrawerFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={pending || (!recoveryCodes && (setup ? !codeComplete : !password))}
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {recoveryCodes ? 'Done' : setup ? 'Turn on' : 'Continue'}
            </Button>
            {!recoveryCodes && (
              <DrawerClose asChild>
                <Button type="button" variant="outline" className="w-full" disabled={pending}>Cancel</Button>
              </DrawerClose>
            )}
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function DisableTwoFactorDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function reset() {
    setPassword('');
    setCode('');
    setPasswordError(null);
    setCodeError(null);
    setFormError(null);
  }

  const mutation = useMutation({
    mutationFn: () => postJson<{ ok: true }>(
      '/api/me/totp', 'DELETE', { currentPassword: password, code }, 'Failed to turn off two-step sign-in',
    ),
    onSuccess: () => {
      toast.success('Two-step sign-in is off');
      queryClient.invalidateQueries({ queryKey: queryKeys.twoFactor() });
      reset();
      onOpenChange(false);
    },
    onError: (e) => {
      const message = e instanceof ApiError ? e.message : 'Failed to turn off two-step sign-in';
      if (e instanceof ApiError && e.status === 403) {
        if (e instanceof TwoFactorError && e.field === 'code') setCodeError(message);
        else setPasswordError(message);
      } else {
        setFormError(message);
      }
    },
  });

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (!o && mutation.isPending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DrawerContent size="content" scrollTogether>
        <DrawerHeader className="text-center">
          <DrawerTitle>Turn off two-step sign-in</DrawerTitle>
          <DrawerDescription>Sign-in will ask for your password only. Your recovery codes stop working.</DrawerDescription>
        </DrawerHeader>
        <form
          className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (mutation.isPending || !password || !code.trim()) return;
            setPasswordError(null);
            setCodeError(null);
            setFormError(null);
            mutation.mutate();
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tf-off-password">Current password</Label>
              <Input
                id="tf-off-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(null);
                  setFormError(null);
                }}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? 'tf-off-password-error' : undefined}
              />
              {passwordError && <p id="tf-off-password-error" role="alert" className="text-xs text-destructive">{passwordError}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tf-off-code">Code from your app, or a recovery code</Label>
              <Input
                id="tf-off-code"
                type="text"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={24}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setCodeError(null);
                  setFormError(null);
                }}
                aria-invalid={codeError ? true : undefined}
                aria-describedby={codeError ? 'tf-off-code-error' : undefined}
              />
              {codeError && <p id="tf-off-code-error" role="alert" className="text-xs text-destructive">{codeError}</p>}
            </div>
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          </div>
          <DrawerFooter>
            <Button
              type="submit"
              variant="destructive"
              className="w-full"
              disabled={mutation.isPending || !password || !code.trim()}
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Turn off
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
