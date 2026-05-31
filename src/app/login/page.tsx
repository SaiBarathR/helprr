'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clapperboard, Loader2 } from 'lucide-react';

const DEVICE_COOKIE = 'helprr-device';
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Where to land after a successful login. The share-target fallback sends
// unauthenticated users to /login?next=/share?... so the shared payload
// survives the round-trip; honor it for same-origin relative paths only,
// rejecting protocol-relative (//) and absolute URLs to avoid open redirects.
// Backslashes are rejected too: the WHATWG URL parser treats "\" as "/", so a
// value like "/\evil.com" would normalize to "//evil.com" and redirect offsite.
function getPostLoginTarget(): string {
  if (typeof window === 'undefined') return '/';
  const next = new URLSearchParams(window.location.search).get('next');
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')) {
    return next;
  }
  return '/';
}

function setDeviceCookieFromMatchMedia(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const device = window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop';
  // Browsers reject Secure cookies over plain HTTP (except localhost), so omit
  // the flag on http:// origins — LAN-hosted self-hosted instances need this.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${DEVICE_COOKIE}=${device}; Path=/; SameSite=Lax${secure}; Max-Age=${DEVICE_COOKIE_MAX_AGE}`;
}

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  // 'local' | 'jellyfin' | null — tracks which button is mid-flight so only the
  // pressed one shows a spinner.
  const [pending, setPending] = useState<'local' | 'jellyfin' | null>(null);
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

  async function submit(endpoint: string, mode: 'local' | 'jellyfin') {
    if (pending) return;
    if (retryAt !== null && retryAt > Date.now()) return; // still in cooldown
    setPending(mode);
    setError('');
    setRetryAt(null);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        // Re-read device class right before redirect in case the user resized
        // the window between mount and login.
        setDeviceCookieFromMatchMedia();
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
      try {
        const data = (await res.json()) as { error?: unknown };
        if (typeof data?.error === 'string') message = data.error;
      } catch {
        // keep the generic fallback
      }
      setError(message);
    } catch {
      setError('Something went wrong');
    } finally {
      setPending(null);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit('/api/auth/login', 'local');
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
          <CardTitle className="text-2xl font-bold">Helprr</CardTitle>
          <p className="text-sm text-muted-foreground">
            Sign in to continue
          </p>
        </CardHeader>
        <CardContent>
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
            {retrySeconds > 0 ? (
              <p className="text-sm text-destructive text-center">
                Too many login attempts. Try again in {retrySeconds}s.
              </p>
            ) : error ? (
              <p className="text-sm text-destructive text-center">{error}</p>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={pending !== null || retrySeconds > 0}
            >
              {pending === 'local' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign In
            </Button>
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
        </CardContent>
      </Card>
    </div>
  );
}
