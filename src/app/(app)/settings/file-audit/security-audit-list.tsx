'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useInfiniteQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

type SecurityAction =
  | 'LOGIN_SUCCEEDED'
  | 'LOGIN_FAILED'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'USER_PERMISSIONS_CHANGED'
  | 'PASSWORD_CHANGED'
  | 'SESSION_REVOKED'
  | 'SERVICE_CREATED'
  | 'SERVICE_UPDATED'
  | 'SERVICE_DELETED'
  | 'SETTINGS_IMPORTED'
  | 'INVITE_CREATED'
  | 'INVITE_REGENERATED'
  | 'INVITE_REVOKED'
  | 'INVITE_ACCEPTED'
  | 'RESET_LINK_CREATED'
  | 'RESET_LINK_REVOKED'
  | 'RESET_LINK_USED'
  | 'INVITE_LINK_FAILED'
  | 'CALENDAR_FEED_CREATED'
  | 'CALENDAR_FEED_ROTATED'
  | 'CALENDAR_FEED_REVOKED'
  | 'MFA_ENABLED'
  | 'MFA_DISABLED'
  | 'MFA_RECOVERY_CODE_USED'
  | 'DATABASE_BACKUP_CREATED'
  | 'DATABASE_BACKUP_FAILED'
  | 'API_TOKEN_CREATED'
  | 'API_TOKEN_REVOKED'
  | 'API_TOKEN_NEW_NETWORK';

export interface SecurityAuditRecord {
  id: string;
  actorUsername: string | null;
  action: SecurityAction;
  targetType: string;
  targetId: string | null;
  targetLabel: string | null;
  fields: string[] | null;
  count: number;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

const ACTION_BADGE: Record<SecurityAction, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  LOGIN_SUCCEEDED: { label: 'SIGN-IN', variant: 'secondary' },
  LOGIN_FAILED: { label: 'SIGN-IN FAILED', variant: 'destructive' },
  USER_CREATED: { label: 'USER ADDED', variant: 'default' },
  USER_UPDATED: { label: 'USER EDIT', variant: 'secondary' },
  USER_DELETED: { label: 'USER DELETE', variant: 'destructive' },
  USER_PERMISSIONS_CHANGED: { label: 'PERMISSIONS', variant: 'secondary' },
  PASSWORD_CHANGED: { label: 'PASSWORD CHANGE', variant: 'secondary' },
  SESSION_REVOKED: { label: 'SESSION REVOKE', variant: 'secondary' },
  SERVICE_CREATED: { label: 'CONNECTION ADDED', variant: 'default' },
  SERVICE_UPDATED: { label: 'CONNECTION EDIT', variant: 'secondary' },
  SERVICE_DELETED: { label: 'CONNECTION DELETE', variant: 'destructive' },
  SETTINGS_IMPORTED: { label: 'SETTINGS IMPORT', variant: 'default' },
  INVITE_CREATED: { label: 'INVITE LINK', variant: 'default' },
  INVITE_REGENERATED: { label: 'NEW INVITE LINK', variant: 'secondary' },
  INVITE_REVOKED: { label: 'INVITE REVOKED', variant: 'secondary' },
  INVITE_ACCEPTED: { label: 'INVITE ACCEPTED', variant: 'default' },
  RESET_LINK_CREATED: { label: 'RESET LINK', variant: 'secondary' },
  RESET_LINK_REVOKED: { label: 'RESET LINK REVOKED', variant: 'secondary' },
  RESET_LINK_USED: { label: 'PASSWORD RESET', variant: 'secondary' },
  INVITE_LINK_FAILED: { label: 'LINK FAILED', variant: 'destructive' },
  CALENDAR_FEED_CREATED: { label: 'CALENDAR LINK', variant: 'default' },
  CALENDAR_FEED_ROTATED: { label: 'CALENDAR LINK RENEWED', variant: 'secondary' },
  CALENDAR_FEED_REVOKED: { label: 'CALENDAR LINK OFF', variant: 'secondary' },
  MFA_ENABLED: { label: '2FA ON', variant: 'default' },
  MFA_DISABLED: { label: '2FA OFF', variant: 'destructive' },
  MFA_RECOVERY_CODE_USED: { label: 'RECOVERY CODE', variant: 'secondary' },
  DATABASE_BACKUP_CREATED: { label: 'DATABASE BACKUP', variant: 'default' },
  DATABASE_BACKUP_FAILED: { label: 'BACKUP FAILED', variant: 'destructive' },
  API_TOKEN_CREATED: { label: 'API TOKEN', variant: 'default' },
  API_TOKEN_REVOKED: { label: 'API TOKEN OFF', variant: 'secondary' },
  API_TOKEN_NEW_NETWORK: { label: 'API TOKEN NEW NETWORK', variant: 'secondary' },
};

const SIGN_IN_METHOD: Record<string, string> = {
  password: 'with password',
  jellyfin: 'with Jellyfin',
  'jellyfin-unlinked': 'with Jellyfin, no Helprr profile linked',
  'jellyfin-wrong-account': 'with Jellyfin, not the account linked to the profile',
  totp: 'with a wrong two-step code',
  'trusted-header': 'through the sign-in proxy',
  'trusted-header-secret': 'through a proxy header without the proxy secret',
  'trusted-header-no-account': 'through the sign-in proxy, no active Helprr account',
};

// The second factor a sign-in passed, after the method (fields[1]).
const SECOND_FACTOR: Record<string, string> = {
  totp: 'and an authenticator code',
  'recovery-code': 'and a recovery code',
};

// Methods whose name Jellyfin or the sign-in proxy vouched for: kept as sent, with no Helprr account.
const ACCOUNT_NAME_METHODS = new Set(['jellyfin-unlinked', 'jellyfin-wrong-account', 'trusted-header-no-account']);
// The name came with a forged proxy header, so it says nothing about accounts.
const NO_NAME_METHODS = new Set(['trusted-header-secret']);

const PAGE_SIZE = 50;

interface SecurityAuditPage {
  page: number;
  total: number;
  records: SecurityAuditRecord[];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function title(record: SecurityAuditRecord): string {
  if (record.action === 'SETTINGS_IMPORTED') return 'Settings backup';
  if (record.action === 'INVITE_LINK_FAILED') return 'Invite or reset link';
  if (record.action === 'SESSION_REVOKED' && record.targetType === 'session') {
    return record.targetLabel ? `A session of ${record.targetLabel}` : 'A session';
  }
  return record.targetLabel ?? 'Unknown';
}

function summary(record: SecurityAuditRecord): string {
  const parts: string[] = [];
  const method = SIGN_IN_METHOD[record.fields?.[0] ?? ''] ?? 'with password';
  switch (record.action) {
    case 'LOGIN_SUCCEEDED':
      parts.push(SECOND_FACTOR[record.fields?.[1] ?? ''] ? `${method} ${SECOND_FACTOR[record.fields![1]]}` : method);
      break;
    case 'LOGIN_FAILED':
      parts.push(method, plural(record.count, 'attempt'));
      // The name, kept as typed, matched no Helprr account.
      if (!record.targetId && !ACCOUNT_NAME_METHODS.has(record.fields?.[0] ?? '') && !NO_NAME_METHODS.has(record.fields?.[0] ?? '')) {
        parts.push('unknown username');
      }
      break;
    case 'PASSWORD_CHANGED':
      parts.push(`${plural(record.count, 'other session')} signed out`);
      break;
    case 'SESSION_REVOKED':
      if (record.targetType === 'user') parts.push(`${plural(record.count, 'other session')} signed out`);
      break;
    case 'RESET_LINK_USED':
      parts.push(`${plural(record.count, 'session')} signed out`);
      break;
    case 'MFA_ENABLED':
      break;
    case 'MFA_DISABLED':
      // fields[0]: 'totp' (by the user), 'admin', 'reset-link' or 'admin-password-reset'.
      if (record.fields?.[0] === 'admin') parts.push(`${plural(record.count, 'session')} signed out`);
      else if (record.fields?.[0] === 'reset-link') parts.push('with a password reset link');
      else if (record.fields?.[0] === 'admin-password-reset') parts.push('HELPRR_ADMIN_PASSWORD_RESET at start-up');
      break;
    case 'MFA_RECOVERY_CODE_USED':
      parts.push(record.fields?.[0] === 'turn-off' ? 'to turn off two-step sign-in' : 'to sign in');
      break;
    case 'API_TOKEN_REVOKED':
      // fields: 'password' or 'status' when a password reset or a disable ended the user's tokens.
      if (record.fields?.[0] === 'admin-password-reset') parts.push(`${plural(record.count, 'token')} ended by HELPRR_ADMIN_PASSWORD_RESET at start-up`);
      else if (record.fields?.length) parts.push(`${plural(record.count, 'token')} ended by a ${record.fields[0]} change`);
      break;
    case 'INVITE_LINK_FAILED':
      parts.push(`${plural(record.count, 'attempt')} with a link that does not work`);
      break;
    case 'DATABASE_BACKUP_CREATED':
    case 'DATABASE_BACKUP_FAILED':
      // fields: the trigger, then the size or the reason it failed.
      parts.push(record.fields?.[0] === 'scheduled' ? 'Scheduled' : 'Back up now', ...(record.fields?.slice(1) ?? []));
      break;
    default:
      if (record.fields?.length) parts.push(record.fields.join(', '));
      // An admin password reset signs out every session of the user.
      if (record.action === 'USER_UPDATED' && record.fields?.includes('password')) {
        parts.push(`${plural(record.count, 'session')} signed out`);
      }
  }
  if (record.actorUsername) parts.push(`by ${record.actorUsername}`);
  return parts.join(' · ');
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true });
}

export function SecurityAuditList() {
  const [hideFailedSignIns, setHideFailedSignIns] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ['security-audit', { hideFailedSignIns }],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ page: String(pageParam), pageSize: String(PAGE_SIZE) });
      if (hideFailedSignIns) params.set('hideFailedSignIns', '1');
      return jsonFetcher<SecurityAuditPage>(`/api/security-audit?${params}`)({ signal });
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      // An empty page ends it even if the total over-reports, so "Load more"
      // never refetches the same page.
      if (lastPage.records.length === 0) return undefined;
      const loaded = allPages.reduce((n, p) => n + p.records.length, 0);
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
  });
  // A new event between pages shifts the offsets by one; drop the repeat.
  const records = useMemo(
    () => [...new Map((query.data?.pages ?? []).flatMap((p) => p.records).map((r) => [r.id, r])).values()],
    [query.data],
  );
  const total = query.data?.pages[query.data.pages.length - 1]?.total ?? 0;

  return (
    <>
      <label className="mx-4 mb-3 flex min-h-[44px] items-center justify-between gap-3 text-sm">
        Hide failed sign-ins and links
        <Switch checked={hideFailedSignIns} onCheckedChange={setHideFailedSignIns} />
      </label>
      {query.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : query.isError && !query.data ? (
        <p className="px-4 py-10 text-center text-sm text-destructive">Failed to load the security log.</p>
      ) : records.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          {hideFailedSignIns ? 'No security events other than failed sign-ins and links.' : 'No security events recorded yet.'}
        </p>
      ) : (
        <div className="space-y-2 px-4">
          {records.map((r) => <SecurityAuditRow key={r.id} record={r} />)}
          {query.hasNextPage && (
            <Button
              variant="outline"
              className="h-9 w-full text-xs"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage
                ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                : <ChevronDown className="mr-2 h-3.5 w-3.5" />}
              {query.isFetchNextPageError ? 'Retry loading more' : `Load more (${records.length} of ${total})`}
            </Button>
          )}
        </div>
      )}
    </>
  );
}

function SecurityAuditRow({ record: r }: { record: SecurityAuditRecord }) {
  const badge = ACTION_BADGE[r.action] ?? { label: r.action, variant: 'secondary' as const };
  const origin = [r.ip, r.userAgent].filter(Boolean).join(' · ');
  const details = summary(r);
  return (
    <div className="rounded-xl border bg-muted/30 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <Badge variant={badge.variant} className="text-[10px]">{badge.label}</Badge>
        <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
      </div>
      <p className="mt-1.5 break-words text-sm font-medium leading-snug">{title(r)}</p>
      {details && <p className="mt-0.5 break-words text-xs text-muted-foreground">{details}</p>}
      {origin && (
        <p className="mt-1 break-all text-[11px] font-mono text-muted-foreground/80">{origin}</p>
      )}
      {r.requestId && (
        <p className="mt-1 break-all text-[11px] font-mono text-muted-foreground/80">request {r.requestId}</p>
      )}
    </div>
  );
}
