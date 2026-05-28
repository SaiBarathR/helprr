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
function getPostLoginTarget(): string {
  if (typeof window === 'undefined') return '/';
  const next = new URLSearchParams(window.location.search).get('next');
  if (next && next.startsWith('/') && !next.startsWith('//')) return next;
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
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Detect device class on the login page so the dashboard SSR reads the
  // correct cookie on the very first authenticated render — avoids the
  // desktop-then-mobile reload thrash for iPhone users.
  useEffect(() => {
    setDeviceCookieFromMatchMedia();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        // Re-read device class right before redirect in case the user resized
        // the window between mount and login.
        setDeviceCookieFromMatchMedia();
        router.replace(getPostLoginTarget());
        router.refresh();
      } else {
        setError('Incorrect password');
      }
    } catch {
      setError('Something went wrong');
    } finally {
      setLoading(false);
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
          <CardTitle className="text-2xl font-bold">Helprr</CardTitle>
          <p className="text-sm text-muted-foreground">
            Enter your password to continue
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sign In
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
