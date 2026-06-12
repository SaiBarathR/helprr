'use client';

import { useState } from 'react';
import { AlertTriangle, KeyRound, Link2Off, Loader2, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type PlayerErrorKind =
  | 'notLinked'
  | 'needsRelink'
  | 'unreachable'
  | 'cors'
  | 'playback';

/**
 * Distinguish "server is down / unreachable from this device" from "reverse
 * proxy strips Jellyfin's CORS headers": no-cors mode succeeds when the server
 * answered but the CORS-mode fetch was blocked.
 */
export async function diagnoseConnectivity(serverUrl: string): Promise<'ok' | 'cors' | 'unreachable'> {
  try {
    const res = await fetch(`${serverUrl}/System/Info/Public`, { mode: 'cors' });
    return res.ok ? 'ok' : 'unreachable';
  } catch {
    try {
      await fetch(`${serverUrl}/System/Info/Public`, { mode: 'no-cors' });
      return 'cors';
    } catch {
      return 'unreachable';
    }
  }
}

const COPY: Record<PlayerErrorKind, { title: string; body: string }> = {
  notLinked: {
    title: 'No Jellyfin account linked',
    body: 'Playback uses your own Jellyfin account. Ask your admin to link one to your Helprr profile.',
  },
  needsRelink: {
    title: 'Sign in to Jellyfin to play',
    body: 'Enter your Jellyfin password to enable playback on this profile.',
  },
  unreachable: {
    title: "Can't reach the Jellyfin server",
    body: 'The Jellyfin server is not reachable from this device. If it lives on a private network, an external URL may need to be configured in Settings → Instances.',
  },
  cors: {
    title: 'Jellyfin blocked the request',
    body: "The server answered but blocked this app's requests (missing CORS headers). A reverse proxy in front of Jellyfin is likely stripping them.",
  },
  playback: {
    title: 'Playback failed',
    body: 'Something went wrong while playing this item.',
  },
};

export function PlayerErrorScreen({
  kind,
  message,
  onRetry,
  onClose,
  onRelinked,
}: {
  kind: PlayerErrorKind;
  /** Extra technical detail shown under the canned copy. */
  message?: string;
  onRetry?: () => void;
  onClose: () => void;
  /** needsRelink only: called after the relink succeeded. */
  onRelinked?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [relinkError, setRelinkError] = useState<string | null>(null);

  const copy = COPY[kind];
  const Icon =
    kind === 'notLinked' ? Link2Off
    : kind === 'needsRelink' ? KeyRound
    : kind === 'unreachable' || kind === 'cors' ? WifiOff
    : AlertTriangle;

  async function submitRelink(event: React.FormEvent) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setRelinkError(null);
    try {
      const res = await fetch('/api/jellyfin/play/relink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setRelinkError(body?.error ?? 'Could not sign in to Jellyfin');
        return;
      }
      onRelinked?.();
    } catch {
      setRelinkError('Could not sign in to Jellyfin');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
      <Icon className="h-10 w-10 text-white/60" aria-hidden />
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">{copy.title}</h1>
        <p className="mx-auto max-w-sm text-sm text-white/60">{copy.body}</p>
        {message && <p className="mx-auto max-w-sm text-xs text-white/40">{message}</p>}
      </div>

      {kind === 'needsRelink' && (
        <form onSubmit={submitRelink} className="flex w-full max-w-xs flex-col gap-3">
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="Jellyfin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border-white/20 bg-white/10 text-white placeholder:text-white/40"
            autoFocus
          />
          {relinkError && <p className="text-xs text-red-400">{relinkError}</p>}
          <Button type="submit" disabled={!password || submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Sign in & play
          </Button>
        </form>
      )}

      <div className="flex gap-3">
        {kind !== 'needsRelink' && onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} className="text-white/70 hover:text-white">
          Close
        </Button>
      </div>
    </div>
  );
}
