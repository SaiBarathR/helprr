'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAppRouter } from '@/components/layout/navigation-provider';
import { jsonFetcher } from '@/lib/query-fetch';
import { useUIStore } from '@/lib/store';

export interface QbitInstance {
  id: string;
  label: string;
  isDefault: boolean;
}

export const QBIT_INSTANCES_KEY = ['qbittorrent', 'instances'] as const;

/** The qBittorrents Helprr has (id, name, default), default first. */
export function useQbitInstances() {
  return useQuery({
    queryKey: QBIT_INSTANCES_KEY,
    queryFn: jsonFetcher<QbitInstance[]>('/api/qbittorrent/instances'),
    staleTime: 60_000,
  });
}

/** The query-key part for an instance: undefined is the default one. */
export const qbitInstanceKey = (instanceId: string | undefined) => instanceId ?? 'default';

/**
 * The qBittorrent the Torrents pages read and act on. A link's `?instance=`
 * (a push opens the instance it is about) comes first and becomes the choice;
 * then the last one picked; else the default instance. `instanceId` is
 * undefined for the default, which every route reads as its default
 * instance, so a single-qBittorrent Helprr sends what it always did. An id
 * that is no longer a qBittorrent is dropped once the list says so.
 *
 * Several components on a page use this at once, so the address stays the one
 * truth while it names an instance: a pick then rewrites it, and every user of
 * the hook switches together when it changes.
 */
export function useQbitInstance() {
  const searchParams = useSearchParams();
  const fromUrl = searchParams?.get('instance') || '';
  const stored = useUIStore((s) => s.torrentsInstance);
  const setStored = useUIStore((s) => s.setTorrentsInstance);
  const router = useAppRouter();
  const { data } = useQbitInstances();
  const instances = Array.isArray(data) ? data : undefined;

  const known = (id: string) => !instances || instances.some((instance) => instance.id === id);
  // A link's instance is used as named, even one no longer listed: the routes
  // then refuse it, rather than the page acting on the same hash in another
  // qBittorrent. A stale saved choice falls back to the default. Before the
  // list loads a choice is used as it is.
  const unknownLink = Boolean(fromUrl && !known(fromUrl));
  const instanceId = fromUrl || (stored && known(stored) ? stored : undefined);

  // Taken once per link, so a pick made while the address still names the
  // instance it is leaving is not undone.
  const adoptedLink = useRef<string | null>(null);
  useEffect(() => {
    if (!instances) return;
    const listed = (id: string) => instances.some((instance) => instance.id === id);
    if (fromUrl !== adoptedLink.current) {
      adoptedLink.current = fromUrl;
      if (fromUrl && listed(fromUrl) && fromUrl !== stored) setStored(fromUrl);
    }
    if (stored && !listed(stored)) setStored('');
  }, [instances, fromUrl, stored, setStored]);

  const select = useCallback((id: string) => {
    setStored(id);
    if (fromUrl) {
      const rest = new URLSearchParams(searchParams?.toString() ?? '');
      rest.set('instance', id);
      router.replace(`${window.location.pathname}?${rest}`);
    }
  }, [fromUrl, router, searchParams, setStored]);

  const list = instances ?? [];
  const current = unknownLink
    ? undefined
    : list.find((instance) => instance.id === instanceId) ?? list.find((instance) => instance.isDefault) ?? list[0];
  return {
    instanceId,
    /** The address names a qBittorrent that is no longer connected (a push sent before it was removed). */
    unknownLink,
    instances: list,
    multiInstance: list.length > 1,
    /** The instance shown (the default when none is chosen), once the list has loaded. */
    current,
    /** For a page header: which qBittorrent this is, when there are several. */
    subtitle: list.length > 1 ? current?.label : undefined,
    select,
  };
}
