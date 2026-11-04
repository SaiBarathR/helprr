'use client';

import { useMutation } from '@tanstack/react-query';
import { ChevronRight, Loader2, Radar } from 'lucide-react';
import Link from '@/components/ui/app-link';
import { GroupedSection } from '@/components/settings/grouped-section';
import { findServiceByType } from '@/lib/settings/service-config';
import type { FoundApp } from '@/lib/app-scan';

async function scan(): Promise<FoundApp[]> {
  const res = await fetch('/api/services/scan', { method: 'POST' });
  if (!res.ok) throw new Error('scan failed');
  return ((await res.json()) as { found: FoundApp[] }).found;
}

/** "Found Sonarr at http://host.docker.internal:8989. Paste its API key." Admins only (the page checks). */
export function FindAppsOnNetwork() {
  const search = useMutation({ mutationFn: scan });
  const found = search.data;

  return (
    <GroupedSection
      title="On this network"
      footer="Looks at this computer and the apps in Helprr's Docker network, on each app's usual port. A container name only answers when that app shares a Docker network with Helprr."
    >
      <button
        type="button"
        onClick={() => search.mutate()}
        disabled={search.isPending}
        className="grouped-row w-full text-left hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors disabled:opacity-70"
      >
        <span className="flex items-center gap-3">
          {search.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <Radar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-[15px] font-medium">{found ? 'Look again' : 'Find apps on this network'}</span>
        </span>
        <span className="text-xs text-muted-foreground">{search.isPending ? 'Looking…' : ''}</span>
      </button>
      <div role="status" className={search.isError || found ? 'px-4 py-3 text-sm' : 'sr-only'}>
        {search.isError ? (
          <span className="text-red-400">Could not look for apps. Try again.</span>
        ) : found ? (
          <span className="text-muted-foreground">
            {found.length === 0
              ? 'Nothing answered on the usual ports.'
              : `${found.length} ${found.length === 1 ? 'app answers' : 'apps answer'} here. Make sure each is yours before you add its key.`}
          </span>
        ) : null}
      </div>
      {found?.map((app) => {
        const config = findServiceByType(app.type);
        const Icon = config?.icon;
        const label = config?.label ?? app.type;
        const href = `/settings/instances/${config?.slug}?${config?.supportsMultiInstance ? 'instance=new&' : ''}url=${encodeURIComponent(app.url)}`;
        const body = (
          <>
            <span className="flex items-center gap-3 min-w-0">
              {Icon && (
                <span className={`flex h-8 w-8 items-center justify-center rounded-md shrink-0 ${config.iconBg} ${config.iconColor}`}>
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
              )}
              <span className="min-w-0">
                <span className="block text-[15px] font-medium">{label} answers here</span>
                <span className="block font-mono text-xs text-muted-foreground break-all">{app.url}</span>
                {app.hasOther && (
                  <span className="block text-xs text-muted-foreground">You already have a {label}; this may be the same one.</span>
                )}
              </span>
            </span>
            {app.connected ? (
              <span className="text-xs text-muted-foreground shrink-0">Connected</span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-primary shrink-0">
                Add its key
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </span>
            )}
          </>
        );
        return app.connected ? (
          <div key={app.url} className="grouped-row">{body}</div>
        ) : (
          <Link key={app.url} href={href} className="grouped-row hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors">
            {body}
          </Link>
        );
      })}
    </GroupedSection>
  );
}
