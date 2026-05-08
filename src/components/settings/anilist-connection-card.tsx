'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Sparkles, Loader2, ChevronRight, ExternalLink, AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface ViewerResponse {
  configured: boolean;
  connected: boolean;
  requiresReauth: boolean;
  user?: {
    id: number;
    name: string;
    avatar: string | null;
    siteUrl: string | null;
    scoreFormat: string | null;
  };
}

const REASON_MESSAGES: Record<string, string> = {
  state_mismatch: 'Authorization state mismatch. Try again.',
  denied: 'You declined the AniList authorization.',
  exchange_failed: 'AniList rejected the authorization code. Double-check your client ID and secret.',
  not_configured: 'AniList connection was lost mid-flight. Re-enter credentials.',
  missing_code: 'AniList did not return an authorization code.',
};

export function AnilistConnectionCard() {
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<ViewerResponse | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [redirectUri, setRedirectUri] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setRedirectUri(`${window.location.origin}/api/services/anilist/callback`);
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/anilist/viewer');
      if (!res.ok) {
        setViewer({ configured: false, connected: false, requiresReauth: false });
        return;
      }
      const data: ViewerResponse = await res.json();
      setViewer(data);
    } catch {
      setViewer({ configured: false, connected: false, requiresReauth: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Surface OAuth callback result, but only fire the toast once per status
  const status = searchParams.get('anilist');
  const reason = searchParams.get('reason');
  useEffect(() => {
    if (!status) return;
    if (status === 'connected') {
      toast.success('Connected to AniList', {
        icon: <Check className="h-4 w-4 text-green-500" />,
      });
      void reload();
    } else if (status === 'error') {
      const message = reason && REASON_MESSAGES[reason] ? REASON_MESSAGES[reason] : 'AniList connection failed';
      toast.error(message, { icon: <AlertTriangle className="h-4 w-4 text-red-500" /> });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, reason]);

  const isConnected = !!viewer?.connected;
  const isConfigured = !!viewer?.configured;
  const requiresReauth = !!viewer?.requiresReauth;

  const statusLabel = useMemo(() => {
    if (loading) return 'Loading…';
    if (isConnected && viewer?.user) return viewer.user.name;
    if (requiresReauth) return 'Reconnect required';
    if (isConfigured) return 'Configured';
    return 'Not connected';
  }, [loading, isConnected, requiresReauth, isConfigured, viewer]);

  async function handleConnect() {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.error('Client ID and Client Secret are required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/services/anilist/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.authorizeUrl) {
        toast.error(data.error || 'Failed to start AniList authorization');
        setSubmitting(false);
        return;
      }
      window.location.href = data.authorizeUrl;
    } catch {
      toast.error('Failed to start AniList authorization');
      setSubmitting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/services/anilist/disconnect', { method: 'POST' });
      if (!res.ok) {
        toast.error('Failed to disconnect');
        return;
      }
      setClientId('');
      setClientSecret('');
      toast.success('AniList disconnected');
      await reload();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="grouped-section mb-6">
      <div className="grouped-section-title">AniList Account</div>
      <div className="grouped-section-content">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="grouped-row w-full active:bg-white/5 transition-colors"
          style={!expanded ? { borderBottom: 'none' } : undefined}
        >
          <div className="flex items-center gap-3 min-w-0">
            {isConnected && viewer?.user?.avatar ? (
              <Image
                src={viewer.user.avatar}
                alt={viewer.user.name}
                width={28}
                height={28}
                className="rounded-full object-cover w-7 h-7"
                unoptimized
              />
            ) : (
              <span className="flex w-7 h-7 items-center justify-center rounded-full bg-pink-500/15 text-pink-400">
                <Sparkles className="h-4 w-4" />
              </span>
            )}
            <span className="text-sm font-medium truncate">AniList</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${isConnected ? 'text-emerald-400' : requiresReauth ? 'text-amber-400' : 'text-muted-foreground'}`}>
              {statusLabel}
            </span>
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          </div>
        </button>

        {expanded && (
          <div className="px-4 pb-4 pt-2 space-y-3 border-b border-[oklch(1_0_0/6%)] last:border-b-0">
            {isConnected && viewer?.user ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-card/40 border border-border/40 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Signed in as</p>
                  <p className="text-sm font-medium">{viewer.user.name}</p>
                  {viewer.user.siteUrl && (
                    <a
                      href={viewer.user.siteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View profile on AniList
                    </a>
                  )}
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Disconnecting…
                    </>
                  ) : (
                    'Disconnect'
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {requiresReauth && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>Your AniList session has expired or was revoked. Re-enter your credentials and reconnect.</span>
                  </div>
                )}
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>
                    1. Open{' '}
                    <a
                      href="https://anilist.co/settings/developer"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      anilist.co/settings/developer
                    </a>{' '}
                    and create a new client.
                  </p>
                  <p>
                    2. Set the <span className="font-mono text-foreground">Redirect URL</span> to:
                  </p>
                  <code className="block rounded border border-border/60 bg-background px-2 py-1 text-[11px] break-all">
                    {redirectUri || 'http://localhost:3050/api/services/anilist/callback'}
                  </code>
                  <p>3. Copy the Client ID and Client Secret AniList shows you below.</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Client ID</Label>
                  <Input
                    placeholder="e.g. 12345"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    className="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Client Secret</Label>
                  <Input
                    type="password"
                    placeholder="Paste secret"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    className="h-10"
                  />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    className="flex-1"
                    onClick={handleConnect}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Redirecting…
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-3.5 w-3.5" />
                        {requiresReauth ? 'Reconnect' : 'Connect to AniList'}
                      </>
                    )}
                  </Button>
                  {isConfigured && (
                    <Button
                      variant="outline"
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                    >
                      {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Remove'}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
