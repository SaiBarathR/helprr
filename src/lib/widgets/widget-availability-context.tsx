'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo } from 'react';
import { ApiError } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import type { WidgetService } from './types';

const EMPTY_SERVICES = new Set<WidgetService>();
const WidgetAvailabilityContext = createContext<ReadonlySet<WidgetService>>(EMPTY_SERVICES);

export function WidgetAvailabilityProvider({
  services,
  children,
}: {
  services: readonly WidgetService[];
  children: React.ReactNode;
}) {
  const fingerprint = [...services].sort().join(',');
  const { data = services } = useQuery<WidgetService[]>({
    queryKey: [...queryKeys.widgetServiceAvailability(), fingerprint],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/services/widget-availability', { signal });
      if (!response.ok) throw new ApiError(response.status, 'Request failed');
      const payload = await response.json();
      return Array.isArray(payload.services) ? payload.services : [];
    },
    initialData: [...services],
    staleTime: 30_000,
    refetchOnMount: true,
    refetchOnWindowFocus: 'always',
  });
  const configuredServices = useMemo(() => new Set(data), [data]);
  return (
    <WidgetAvailabilityContext.Provider value={configuredServices}>
      {children}
    </WidgetAvailabilityContext.Provider>
  );
}

export function useConfiguredWidgetServices(): ReadonlySet<WidgetService> {
  return useContext(WidgetAvailabilityContext);
}
