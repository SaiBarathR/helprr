'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clapperboard, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { completeBrowserSignIn, setDeviceCookieFromMatchMedia } from '@/lib/client-sign-in';
import { countPasswordCodePoints, LOCAL_PASSWORD_MIN_LENGTH } from '@/lib/password-policy';

/**
 * Creating the first admin, on a brand-new install with no APP_PASSWORD. The
 * server decides whether this is allowed; once an admin exists it sends people
 * to the sign-in page.
 */
export default function SetupPage() {
  const router = useRouter();
  // 'checking' until the server answers; 'unreachable' keeps the person here with a
  // retry, since sending a brand-new install to a sign-in page would be a dead end.
  const [status, setStatus] = useState<'checking' | 'ready' | 'unreachable'>('checking');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const loadState = useCallback(() => {
    void fetch('/api/setup/state', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`setup state ${res.status}`);
        return res.json() as Promise<{ needsAdmin?: boolean }>;
      })
      .then((state) => {
        if (state.needsAdmin === true) setStatus('ready');
        else router.replace('/login');
      })
      .catch(() => setStatus('unreachable'));
  }, [router]);

  useEffect(() => {
    setDeviceCookieFromMatchMedia();
    loadState();
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
      const res = await fetch('/api/setup/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        try {
          await completeBrowserSignIn();
        } catch {
          // The admin exists; only this browser's old data could not be cleared.
          setError('Your admin account was created, but this browser could not be prepared. Sign in to continue.');
          setTimeout(() => router.replace('/login'), 2500);
          return;
        }
        router.replace('/');
        router.refresh();
        return;
      }
      if (res.status === 404 || res.status === 409) {
        router.replace('/login');
        return;
      }
      let message = 'Could not create the admin';
      try {
        const data = (await res.json()) as { error?: unknown };
        if (typeof data?.error === 'string') message = data.error;
      } catch {
        // keep the generic message
      }
      setError(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="rounded-xl bg-primary/10 p-3">
              <Clapperboard className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">{status === 'ready' ? 'Welcome to Helprr' : 'Helprr'}</CardTitle>
          {status === 'ready' && (
            <p className="text-sm text-muted-foreground">Create your admin account to get started</p>
          )}
        </CardHeader>
        <CardContent>
          {status === 'checking' ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
            </div>
          ) : status === 'unreachable' ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground" role="alert">Couldn&apos;t reach Helprr. It may still be starting.</p>
              <Button type="button" variant="outline" className="w-full" onClick={retry}>
                Try again
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="text"
                aria-label="Username"
                placeholder="Username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
              <Input
                type="password"
                aria-label="Password"
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
                Create admin
              </Button>
              <p className="flex gap-2 text-xs text-muted-foreground">
                <ShieldAlert className="h-4 w-4 shrink-0 text-orange-400" aria-hidden="true" />
                <span>
                  Anyone who opens Helprr before you can take this step, so do it before Helprr is
                  reachable from the internet.
                </span>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
