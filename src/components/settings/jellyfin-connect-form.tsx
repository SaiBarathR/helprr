'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The Jellyfin sign-in fields, without any surrounding chrome.
 *
 * Shared by the Account settings section and the gate the player shows in place
 * of the video, so both post to the same route and report the same errors. The
 * caller supplies the framing; this owns only the fields and the request.
 */
export function JellyfinConnectForm({
  onConnected,
  submitLabel = 'Connect Jellyfin account',
  autoFocus = false,
}: {
  onConnected: (jellyfinUsername: string) => void;
  submitLabel?: string;
  autoFocus?: boolean;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/jellyfin/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Could not connect to Jellyfin');
        return;
      }
      setUsername('');
      setPassword('');
      onConnected(typeof data.jellyfinUsername === 'string' ? data.jellyfinUsername : username);
    } catch {
      setError('Could not reach Helprr. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Input
        type="text"
        placeholder="Jellyfin username"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoFocus={autoFocus}
        required
      />
      <Input
        type="password"
        placeholder="Jellyfin password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  );
}
