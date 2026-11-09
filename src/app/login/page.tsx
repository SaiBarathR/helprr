'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, Clapperboard, Loader2 } from 'lucide-react';
import { clearUserScopedBrowserCaches, subscribeToAuthenticationBoundaries } from '@/lib/client-cache';
import { completeBrowserSignIn, setDeviceCookieFromMatchMedia } from '@/lib/client-sign-in';
import { SIGN_IN_HELP_URL } from '@/lib/docs-links';

// Where to land after a successful login. The share-target fallback sends
// unauthenticated users to /login?next=/share?... so the shared payload
// survives the round-trip; honor it for same-origin relative paths only,
// rejecting protocol-relative (//) and absolute URLs to avoid open redirects.
// Backslashes are rejected too: the WHATWG URL parser treats "\" as "/", so a
// value like "/\evil.com" would normalize to "//evil.com" and redirect offsite.
// The code step's pending token, kept for this tab while it is valid: iOS often
// reloads a home-screen app after a switch to the authenticator. It is not a
// session; it only lets /api/auth/login/totp make one, with a code.
const MFA_PENDING_KEY = 'helprr-mfa-pending';
// A little under the server's five minutes.
const MFA_PENDING_KEEP_MS = 4.5 * 60_000;

function storeMfaPending(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(MFA_PENDING_KEY, JSON.stringify({ token, until: Date.now() + MFA_PENDING_KEEP_MS }));
    else sessionStorage.removeItem(MFA_PENDING_KEY);
  } catch {
    // Private mode or storage off: the code step just won't survive a reload.
  }
}

function readMfaPending(): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(MFA_PENDING_KEY) ?? 'null') as { token?: unknown; until?: unknown } | null;
    if (saved && typeof saved.token === 'string' && typeof saved.until === 'number' && saved.until > Date.now()) return saved.token;
    sessionStorage.removeItem(MFA_PENDING_KEY);
  } catch {
    // ignore
  }
  return null;
}

function getPostLoginTarget(): string {
  if (typeof window === 'undefined') return '/';
  const next = new URLSearchParams(window.location.search).get('next');
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')) {
    return next;
  }
  return '/';
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // 'local' | 'jellyfin' | null — tracks which button is mid-flight so only the
  // pressed one shows a spinner.
  const [pending, setPending] = useState<'local' | 'jellyfin' | 'code' | 'trusted' | null>(null);
  // Two-step sign-in: the password was right and the server wants a code. The
  // token is not a session; it only lets /api/auth/login/totp make one.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  // Signed out with the sign-in proxy on: wait for a tap before trying it.
  const [signedOut, setSignedOut] = useState(false);
  // When the server returns 429, hold the retry deadline (epoch ms) so the error
  // can count down live instead of showing a frozen "try again in N seconds".
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const router = useRouter();

  const retrySeconds =
    retryAt !== null ? Math.max(0, Math.ceil((retryAt - nowMs) / 1000)) : 0;

  // Detect device class on the login page so the dashboard SSR reads the
  // correct cookie on the very first authenticated render — avoids the
  // desktop-then-mobile reload thrash for iPhone users.
  useEffect(() => {
    setDeviceCookieFromMatchMedia();
  }, []);

  // Back to the code step after a reload, while its token is still good.
  useEffect(() => {
    const saved = readMfaPending();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is read after mount so the server render matches
    if (saved) setMfaToken(saved);
  }, []);

  // A brand-new install with no APP_PASSWORD has nobody to sign in as yet.
  useEffect(() => {
    void fetch('/api/setup/state', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((state: { needsAdmin?: boolean } | null) => {
        if (state?.needsAdmin) router.replace('/setup');
      })
      .catch(() => undefined);
  }, [router]);

  // A session that ended here (signed out, expired, or revoked from another
  // device) leaves page shells carrying its identity, posters and saved reads
  // in this browser. Drop them as soon as the server confirms there is no
  // session, not only at the next sign-in, which still clears again and fails
  // closed on its own. A signed-in visitor (Login opened from another tab) and
  // an offline one keep them. A sign-in here or in another tab first makes the
  // answer stale, so it cancels the clear rather than wipe the new session's.
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToAuthenticationBoundaries(() => {
      active = false;
    });
    void fetch('/api/me', { cache: 'no-store' })
      .then((res) => (active && res.status === 401 ? clearUserScopedBrowserCaches() : undefined))
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Trusted-header sign-in, one attempt. Through the sign-in proxy that signs
  // the visitor straight in; any other way (such as Helprr's own port) gets a
  // 401, and the form stays as it is. Resolves true when it signed in.
  const tryTrustedSignIn = useCallback(async (isActive: () => boolean): Promise<boolean> => {
    setPending('trusted');
    setError('');
    let signedIn = false;
    try {
      const res = await fetch('/api/auth/trusted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!isActive()) return false;
      if (res.ok) {
        storeMfaPending(null);
        await completeBrowserSignIn();
        router.replace(getPostLoginTarget());
        router.refresh();
        signedIn = true;
        return true;
      }
      const retryAfter = res.status === 429 ? Number(res.headers.get('Retry-After')) : NaN;
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        setNowMs(Date.now());
        setRetryAt(Date.now() + retryAfter * 1000);
      } else if (res.status !== 401) {
        const data = (await res.json().catch(() => ({}))) as { error?: unknown };
        if (isActive() && typeof data.error === 'string') setError(data.error);
      }
    } catch (error) {
      if (isActive()) setError(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      // Stays pending once signed in, so the button cannot sign in twice while the app loads.
      if (isActive() && !signedIn) setPending((current) => (current === 'trusted' ? null : current));
    }
    return false;
  }, [router]);

  // When the server says trusted-header sign-in is on, try it once, unless this
  // browser just signed out: then wait for a tap on Sign in, so signing out
  // does not sign straight back in.
  useEffect(() => {
    let active = true;
    void (async () => {
      const state = await fetch('/api/auth/trusted', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { enabled?: unknown; signedOut?: unknown } | null) => body)
        .catch(() => null);
      if (!active || state?.enabled !== true) return;
      if (state.signedOut === true) {
        setSignedOut(true);
        return;
      }
      await tryTrustedSignIn(() => active);
    })();
    return () => {
      active = false;
    };
  }, [tryTrustedSignIn]);

  async function signInAgain() {
    if (pending) return;
    // Not through the proxy (or it refused): the normal form, with any error.
    if (!(await tryTrustedSignIn(() => true))) setSignedOut(false);
  }

  // Tick once a second while a retry countdown is active; clear it when it hits 0.
  useEffect(() => {
    if (retryAt === null) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNowMs(t);
      if (t >= retryAt) setRetryAt(null);
    }, 1000);
    return () => clearInterval(id);
  }, [retryAt]);

  async function submit(endpoint: string, mode: 'local' | 'jellyfin' | 'code') {
    if (pending) return;
    if (retryAt !== null && retryAt > Date.now()) return; // still in cooldown
    setPending(mode);
    setError('');
    setRetryAt(null);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'code' ? { mfaToken, code } : { username, password }),
      });

      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { mfaRequired?: unknown; mfaToken?: unknown };
        if (data.mfaRequired === true && typeof data.mfaToken === 'string') {
          storeMfaPending(data.mfaToken);
          setMfaToken(data.mfaToken);
          setCode('');
          setUseRecoveryCode(false);
          return;
        }
        storeMfaPending(null);
        await completeBrowserSignIn();
        router.replace(getPostLoginTarget());
        router.refresh();
        return;
      }

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          // Live countdown replaces the static error text.
          setNowMs(Date.now());
          setRetryAt(Date.now() + retryAfter * 1000);
          return;
        }
      }

      let message = 'Sign in failed';
      let mfaExpired = false;
      try {
        const data = (await res.json()) as { error?: unknown; mfaExpired?: unknown };
        if (typeof data?.error === 'string') message = data.error;
        mfaExpired = data?.mfaExpired === true;
      } catch {
        // keep the generic fallback
      }
      // The code step timed out or the account changed: start again from the password.
      if (mfaExpired) leaveCodeStep();
      setError(message);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setPending(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit('/api/auth/login', 'local');
  }

  function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit('/api/auth/login/totp', 'code');
  }

  function leaveCodeStep() {
    storeMfaPending(null);
    setMfaToken(null);
    setCode('');
    setPassword('');
  }

  const errorText = retrySeconds > 0 ? (
    <p className="text-sm text-destructive text-center">
      Too many login attempts. Try again in {retrySeconds}s.
    </p>
  ) : error ? (
    <p className="text-sm text-destructive text-center">{error}</p>
  ) : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="rounded-xl bg-primary/10 p-3">
              <Clapperboard className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Helprr</CardTitle>
          <p className="text-sm text-muted-foreground">
            {mfaToken
              ? 'Two-step sign-in'
              : pending === 'trusted' ? 'Signing you in…' : signedOut ? 'Signed out' : 'Sign in to continue'}
          </p>
        </CardHeader>
        <CardContent>
          {mfaToken ? (
            <form onSubmit={handleCodeSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">
                {useRecoveryCode
                  ? 'Enter one of the recovery codes you saved. Each one works once.'
                  : 'Enter the 6-digit code from your authenticator app.'}
              </p>
              <Input
                key={useRecoveryCode ? 'recovery' : 'totp'}
                type="text"
                aria-label={useRecoveryCode ? 'Recovery code' : 'Authenticator code'}
                placeholder={useRecoveryCode ? 'XXXX-XXXX-XXXX-XXXX' : '123456'}
                inputMode={useRecoveryCode ? 'text' : 'numeric'}
                autoComplete={useRecoveryCode ? 'off' : 'one-time-code'}
                autoCapitalize={useRecoveryCode ? 'characters' : 'off'}
                autoCorrect="off"
                spellCheck={false}
                maxLength={useRecoveryCode ? 24 : 8}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
              />
              {errorText}
              <Button
                type="submit"
                className="w-full"
                disabled={pending !== null || retrySeconds > 0 || code.trim().length === 0}
              >
                {pending === 'code' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verify
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  className="min-h-[44px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => {
                    setUseRecoveryCode((v) => !v);
                    setCode('');
                    setError('');
                  }}
                >
                  {useRecoveryCode ? 'Use the authenticator app' : 'Use a recovery code'}
                </button>
                <button
                  type="button"
                  className="min-h-[44px] text-muted-foreground underline-offset-2 hover:underline"
                  disabled={pending !== null}
                  onClick={() => {
                    leaveCodeStep();
                    setError('');
                  }}
                >
                  Back
                </button>
              </div>
            </form>
          ) : signedOut ? (
            <div className="space-y-4">
              {errorText}
              <Button
                type="button"
                className="w-full"
                disabled={pending !== null || retrySeconds > 0}
                onClick={() => void signInAgain()}
              >
                {pending === 'trusted' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign in
              </Button>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="text"
              placeholder="Username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
            <Input
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {errorText}
            <Button
              type="submit"
              className="w-full"
              disabled={pending !== null || retrySeconds > 0}
            >
              {pending === 'local' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign In
            </Button>
            <details className="group text-center text-sm text-muted-foreground">
              <summary className="mx-auto flex w-fit min-h-11 cursor-pointer list-none items-center gap-1 rounded-md px-2 hover:text-foreground [&::-webkit-details-marker]:hidden">
                Forgot your password?
                <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-1 text-xs">
                Ask whoever runs Helprr to reset it in Settings → Users. If you run Helprr, see{' '}
                <a
                  href={SIGN_IN_HELP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Recover the admin account
                </a>
                .
              </p>
            </details>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={pending !== null || retrySeconds > 0}
              onClick={() => submit('/api/auth/jellyfin', 'jellyfin')}
            >
              {pending === 'jellyfin' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign in with Jellyfin
            </Button>
          </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
