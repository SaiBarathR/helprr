'use client';

import { createContext, useContext } from 'react';
import type { Capability } from '@/lib/capabilities';

export interface MePayload {
  id: string;
  name: string;
  username?: string;
  role: 'admin' | 'member';
  template: string;
  capabilities: Partial<Record<Capability, boolean>>;
  /** Whether a Seerr connection is configured — drives the in-app "Request" button. */
  seerrConfigured: boolean;
  /** Whether a TMDB connection is configured — gates Discover-backed links (e.g. collection pages). */
  tmdbConfigured: boolean;
  /** The user's linked Seerr user id (string), if any — used to default "Request As". */
  seerrUserId: string | null;
  /**
   * Whether this user resolves to a Jellyfin account (admin → connection user;
   * member → their linked jellyfinUserId). Gates the watch-status overlay fetch
   * so unlinked users never fire a guaranteed-empty request.
   */
  jellyfinLinked: boolean;
  /** Whether HELPRR_CUSTOM_HEADERS is enabled — gates the custom-headers editor in instance settings. */
  customHeadersEnabled: boolean;
}

const PermissionContext = createContext<MePayload | null>(null);

// SSR-provided in (app)/layout.tsx so the very first render already knows the
// user's capabilities (no fetch flash). UX-only — never the security boundary.
export function PermissionProvider({
  value,
  children,
}: {
  value: MePayload;
  children: React.ReactNode;
}) {
  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function useMe(): MePayload | null {
  return useContext(PermissionContext);
}

/** Pure predicate so non-hook contexts (filters) can check without breaking hook rules. */
export function hasCapability(me: MePayload | null, cap: Capability): boolean {
  if (!me) return false;
  if (me.role === 'admin') return true;
  return me.capabilities[cap] === true;
}

/** Hook form of hasCapability for conditional rendering of buttons/sections. */
export function useCan(cap: Capability): boolean {
  return hasCapability(useContext(PermissionContext), cap);
}
