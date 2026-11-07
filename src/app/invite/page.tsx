'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clapperboard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from '@/components/ui/app-link';
import { completeBrowserSignIn, setDeviceCookieFromMatchMedia } from '@/lib/client-sign-in';
import { countPasswordCodePoints, LOCAL_PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

interface LinkInfo {
  purpose: 'invite' | 'reset';
  username: string;
  displayName: string;
}

const INVALID = 'This link is invalid or has expired. Ask your admin for a new one.';
// A reload after the page dropped the fragment, or a link cut short when pasted.
const MISSING = 'Open the link from your message again. This address has no link key in it.';

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (typeof data?.error === 'string') return data.error;
  } catch {
    // keep the fallback
  }
  return fallback;
}

/**
 * Where an invited person (or one given a password-reset link) chooses their
 * own password. The link is /invite#<token>: browsers never send a fragment to
 * a server, and the page drops it from the address bar and this tab's Back
 * history as soon as it has read it. The server decides whether the link works; every unusable
 * link gets the same answer.
 */
export default function InvitePage() {
  const router = useRouter();
  // Read once: after that the fragment is gone from the URL.
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid' | 'missing' | 'unreachable' | 'done'>('checking');
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [notice, setNotice] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const loadState = useCallback(() => {
    const token = tokenRef.current;
    if (!token) {
      setStatus('missing');
      return;
    }
    void fetch('/api/invite/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    })
      .then(async (res) => {
        if (res.ok) {
          setInfo((await res.json()) as LinkInfo);
          setStatus('ready');
          return;
        }
        if (res.status === 404) {
          setStatus('invalid');
          return;
        }
        // Throttled or unavailable: say so, and offer a retry.
        setNotice(await errorMessage(res, "Couldn't reach Helprr."));
        setStatus('unreachable');
      })
      .catch(() => {
        setNotice("Couldn't reach Helprr.");
        setStatus('unreachable');
      });
  }, []);

  useEffect(() => {
    if (tokenRef.current === null) tokenRef.current = window.location.hash.slice(1);
    // One tick later, so the router has hooked history.replaceState by then
    // and keeps its own copy of the URL in step (it would put the fragment back).
    const drop = window.location.hash
      ? window.setTimeout(() => window.history.replaceState(null, '', '/invite'), 0)
      : undefined;
    setDeviceCookieFromMatchMedia();
    loadState();
    return () => window.clearTimeout(drop);
  }, [loadState]);

  function retry() {
    setStatus('checking');
    loadState();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError('');
    if (countPasswordCodePoints(password) < LOCAL_PASSWORD_MIN_LENGTH) {
      setError(`Use at least ${LOCAL_PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords are different.');
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenRef.current, password }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { signInWithCode?: unknown };
        if (data.signInWithCode === true) {
          // Two-step sign-in is on: no session was made here.
          setNotice('Your password is set. Sign in with it and a code from your authenticator app.');
          setStatus('done');
          return;
        }
        try {
          await completeBrowserSignIn();
        } catch {
          // The password is set; only this browser's old data could not be cleared.
          setError('Your password is set, but this browser could not be prepared. Sign in to continue.');
          setTimeout(() => router.replace('/login'), 2500);
          return;
        }
        router.replace('/');
        router.refresh();
        return;
      }
      if (res.status === 404) {
        setStatus('invalid');
        return;
      }
      setError(await errorMessage(res, 'Could not set the password'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  const isReset = info?.purpose === 'reset';

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="rounded-xl bg-primary/10 p-3">
              <Clapperboard className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">
            {status === 'ready' && info
              ? isReset ? 'Reset your password' : `Welcome, ${info.displayName}`
              : 'Helprr'}
          </CardTitle>
          {status === 'ready' && info && (
            <p className="text-sm text-muted-foreground">
              {isReset ? 'Choose a new password for ' : 'Choose a password for your account, '}
              <span className="font-medium text-foreground">@{info.username}</span>
              {isReset ? '. This signs you out everywhere else.' : '.'}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {status === 'checking' ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
            </div>
          ) : status === 'invalid' || status === 'missing' ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground" role="alert">{status === 'missing' ? MISSING : INVALID}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href="/login">Go to sign in</Link>
              </Button>
            </div>
          ) : status === 'done' ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground" role="status">{notice}</p>
              <Button asChild className="w-full">
                <Link href="/login">Go to sign in</Link>
              </Button>
            </div>
          ) : status === 'unreachable' ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground" role="alert">{notice}</p>
              <Button type="button" variant="outline" className="w-full" onClick={retry}>
                Try again
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Lets a password manager save the new password against the right account. */}
              <input type="text" name="username" autoComplete="username" value={info?.username ?? ''} readOnly hidden />
              <Input
                type="password"
                aria-label="New password"
                placeholder={`Password (at least ${LOCAL_PASSWORD_MIN_LENGTH} characters)`}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
              <Input
                type="password"
                aria-label="Password again"
                placeholder="Password again"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {error && <p className="text-sm text-destructive text-center" role="alert">{error}</p>}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isReset ? 'Set new password' : 'Set password and sign in'}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Using Helprr from your Home Screen? Sign in there afterwards with @{info?.username} and
                this password.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
