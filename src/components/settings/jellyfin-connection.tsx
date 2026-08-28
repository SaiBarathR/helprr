'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GroupedSection } from '@/components/settings/grouped-section';
import { useMe } from '@/components/permission-provider';

/**
 * Connect the member's own Jellyfin account.
 *
 * Playback runs on the member's Jellyfin token rather than the admin API key,
 * because Jellyfin attributes a session to whoever the token belongs to — an
 * API-key session belongs to nobody. Signing in with Jellyfin connects the
 * account as a side effect, so this is for members who use a Helprr password,
 * and for reconnecting after a token is revoked.
 */
export function JellyfinConnection() {
  const me = useMe();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me?.jellyfinConfigured) return null;

  async function connect(event: React.FormEvent) {
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
        setError(data.error ?? 'Could not connect to Jellyfin');
        return;
      }
      setUsername('');
      setPassword('');
      toast.success(`Connected as ${data.jellyfinUsername}`);
      router.refresh();
    } catch {
      setError('Could not reach Helprr. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch('/api/account/jellyfin/link', { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Failed to disconnect');
        return;
      }
      toast.success('Jellyfin account disconnected');
      router.refresh();
    } catch {
      toast.error('Failed to disconnect');
    } finally {
      setBusy(false);
    }
  }

  if (me.jellyfinConnected) {
    return (
      <GroupedSection
        title="Jellyfin"
        footer="Watching in Helprr is recorded on your own Jellyfin account."
      >
        <div className="grouped-row flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <span className="text-sm font-medium">Connected</span>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={disconnect} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Disconnect
          </Button>
        </div>
      </GroupedSection>
    );
  }

  return (
    <GroupedSection
      title="Jellyfin"
      footer="Helprr never stores your Jellyfin password — only the access token the server returns."
    >
      <form onSubmit={connect} className="grouped-row grouped-row-stacked space-y-3">
        <p className="text-sm text-muted-foreground">
          Sign in to Jellyfin once so playback, resume points, and history are recorded on your own
          account instead of being unattributed.
        </p>
        <Input
          type="text"
          placeholder="Jellyfin username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
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
          Connect Jellyfin account
        </Button>
      </form>
    </GroupedSection>
  );
}
