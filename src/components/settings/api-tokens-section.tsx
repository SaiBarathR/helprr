'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GroupedSection } from '@/components/settings/grouped-section';
import { API_TOKEN_SCOPES } from '@/lib/api-token-scopes';
import { STATUS_API_GUIDE_URL } from '@/lib/docs-links';
import { formatDate } from '@/lib/date-format';
import { jsonFetcher } from '@/lib/query-fetch';

interface ApiToken {
  id: string;
  name: string;
  scopes: string[];
  /** The scopes the owner still holds: the only ones a request uses. */
  activeScopes: string[];
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ApiTokens {
  tokens: ApiToken[];
  /** May make tokens and have them work (api.tokens). */
  allowed: boolean;
  grantableScopes: string[];
  max: number;
}

export const API_TOKENS_KEY = ['api-tokens'] as const;
const EXPIRY_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'Never' },
] as const;
const SCOPE_LABEL = new Map<string, string>(API_TOKEN_SCOPES.map((def) => [def.scope, def.label]));

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : formatDistanceToNow(date, { addSuffix: true });
}

function describe(token: ApiToken, now: number): string {
  const expired = token.expiresAt !== null && new Date(token.expiresAt).getTime() <= now;
  const used = ago(token.lastUsedAt);
  return [
    expired ? 'Expired' : token.expiresAt ? `Expires ${formatDate(token.expiresAt)}` : 'No expiry',
    used ? `last used ${used}` : 'not used yet',
  ].join(' · ');
}

/**
 * The person's personal API tokens for the read-only status API (iOS Shortcuts,
 * Homepage and other dashboards). Helprr keeps only a hash of each, so a token
 * is shown once, right after it is made.
 */
export function ApiTokensSection() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: API_TOKENS_KEY, queryFn: jsonFetcher<ApiTokens>('/api/me/api-tokens') });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<string>('90');
  const [made, setMade] = useState<{ name: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [turningOff, setTurningOff] = useState<ApiToken | null>(null);
  const [now] = useState(() => Date.now());

  const tokens = status.data?.tokens ?? [];
  const allowed = status.data?.allowed === true;
  const grantable = status.data?.grantableScopes ?? [];
  const full = tokens.length >= (status.data?.max ?? Infinity);

  function openCreate() {
    setName('');
    setScopes([]);
    setExpiry('90');
    setMade(null);
    setCreating(true);
  }

  async function create() {
    setBusy(true);
    try {
      const res = await fetch('/api/me/api-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes, expiresInDays: expiry === 'never' ? null : Number(expiry) }),
      });
      const body = (await res.json().catch(() => null)) as { token?: string; name?: string; error?: string } | null;
      if (!res.ok || !body?.token) throw new Error(body?.error ?? 'Failed to make the API token');
      setMade({ name: body.name ?? name.trim(), token: body.token });
      await queryClient.invalidateQueries({ queryKey: API_TOKENS_KEY });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to make the API token');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(token: ApiToken) {
    setBusy(true);
    try {
      const res = await fetch(`/api/me/api-tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE' });
      // Already gone (turned off on another device) is what was asked for.
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      toast.success(`“${token.name}” turned off`);
      await queryClient.invalidateQueries({ queryKey: API_TOKENS_KEY });
    } catch {
      toast.error('Failed to turn off the API token');
    } finally {
      setBusy(false);
      setTurningOff(null);
    }
  }

  async function copy() {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.token);
      toast.success('Token copied');
    } catch {
      toast.error('Copy failed — select the token and copy it');
    }
  }

  return (
    <>
      <GroupedSection
        title={status.data ? `API tokens · ${tokens.length}` : 'API tokens'}
        footer={
          <>
            {status.data && !allowed
              ? 'Making API tokens is not turned on for you. Ask whoever runs Helprr. '
              : 'Read-only access for Shortcuts and dashboards. '}
            <a href={STATUS_API_GUIDE_URL} target="_blank" rel="noreferrer" className="text-primary normal-case tracking-normal">
              How to use them
            </a>
          </>
        }
      >
        {status.isPending ? (
          <div className="px-4 py-3 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : status.isError ? (
          <div className="px-4 py-3 text-sm text-red-400">Couldn&apos;t load your API tokens.</div>
        ) : (
          <>
            {tokens.map((token) => {
              const inactive = token.scopes.filter((scope) => !token.activeScopes.includes(scope));
              return (
                <div key={token.id} className="grouped-row gap-2 py-1.5 pr-2">
                  <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{token.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate">{describe(token, now)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {token.scopes.map((scope) => SCOPE_LABEL.get(scope) ?? scope).join(', ')}
                    </div>
                    {!allowed ? (
                      <div className="text-xs text-amber-400 mt-0.5">Not working: API tokens are turned off for you</div>
                    ) : inactive.length > 0 && (
                      <div className="text-xs text-amber-400 mt-0.5">
                        Not used now, as you no longer have access: {inactive.map((scope) => SCOPE_LABEL.get(scope) ?? scope).join(', ')}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 shrink-0 text-destructive hover:text-destructive"
                    aria-label={`Turn off ${token.name}`}
                    onClick={() => setTurningOff(token)}
                    disabled={busy}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            {allowed ? (
              <button
                type="button"
                className="grouped-row w-full gap-2 text-sm text-primary disabled:opacity-60"
                onClick={openCreate}
                disabled={busy || full || grantable.length === 0}
              >
                <Plus className="h-4 w-4" />
                {full ? `Up to ${status.data?.max} tokens; turn one off first` : grantable.length === 0 ? 'Nothing you can share through a token' : 'New API token'}
              </button>
            ) : tokens.length === 0 && (
              <div className="grouped-row text-sm text-muted-foreground">Not turned on for you</div>
            )}
          </>
        )}
      </GroupedSection>

      <Dialog open={creating} onOpenChange={(open) => { if (!open) { setCreating(false); setMade(null); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{made ? `Your “${made.name}” token` : 'New API token'}</DialogTitle>
            <DialogDescription>
              {made
                ? 'Copy it now: Helprr keeps only a fingerprint of it, so it is shown only once.'
                : 'A token reads only what you tick, never more than you can see yourself, and can change nothing.'}
            </DialogDescription>
          </DialogHeader>

          {made ? (
            <div className="space-y-3">
              <Input
                readOnly
                value={made.token}
                aria-label="API token"
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button type="button" className="w-full" onClick={copy}>
                <Copy className="mr-2 h-4 w-4" />
                Copy token
              </Button>
              <p className="text-xs text-muted-foreground">
                Send it as <code>Authorization: Bearer &lt;token&gt;</code>. Keep it private: anyone who has it can
                read what you ticked until it expires or you turn it off.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setCreating(false); setMade(null); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="api-token-name">Name</Label>
                <Input
                  id="api-token-name"
                  value={name}
                  maxLength={60}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="iPhone Shortcuts"
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium mb-2">It may read</legend>
                {API_TOKEN_SCOPES.filter((def) => grantable.includes(def.scope)).map((def) => (
                  <label key={def.scope} className="flex items-center gap-3 min-h-[36px] text-sm">
                    <Checkbox
                      checked={scopes.includes(def.scope)}
                      onCheckedChange={(checked) => setScopes((current) => (
                        checked === true ? [...current, def.scope] : current.filter((scope) => scope !== def.scope)
                      ))}
                    />
                    {def.label}
                  </label>
                ))}
              </fieldset>
              <div className="space-y-2">
                <Label htmlFor="api-token-expiry">Expires after</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger id="api-token-expiry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
                <Button type="button" onClick={create} disabled={busy || !name.trim() || scopes.length === 0}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Make token
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={turningOff !== null}
        onOpenChange={(open) => { if (!open) setTurningOff(null); }}
        title={turningOff ? `Turn off “${turningOff.name}”?` : 'Turn off token?'}
        description="Anything using it is refused from its next request. This cannot be undone."
        confirmLabel="Turn off"
        destructive
        busy={busy}
        onConfirm={async () => {
          if (turningOff) await turnOff(turningOff);
        }}
      />
    </>
  );
}
