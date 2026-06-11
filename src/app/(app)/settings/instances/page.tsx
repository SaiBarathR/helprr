'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { AnilistConnectionCard } from '@/components/settings/anilist-connection-card';
import { SERVICE_CONFIG } from '@/lib/settings/service-config';

interface LoadedConnection {
  id: string;
  type: string;
  label: string;
  isDefault: boolean;
}

export default function InstancesIndexPage() {
  const [connections, setConnections] = useState<LoadedConnection[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/services');
        if (!res.ok) {
          if (!cancelled) setLoaded(true);
          return;
        }
        const data = (await res.json()) as LoadedConnection[];
        if (!cancelled) {
          setConnections(Array.isArray(data) ? data : []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const byType = new Map<string, LoadedConnection[]>();
  for (const conn of connections) {
    if (typeof conn?.type !== 'string') continue;
    const arr = byType.get(conn.type) ?? [];
    arr.push(conn);
    byType.set(conn.type, arr);
  }

  const multiInstanceConfigs = SERVICE_CONFIG.filter((c) => c.supportsMultiInstance);
  const singleInstanceConfigs = SERVICE_CONFIG.filter((c) => !c.supportsMultiInstance);

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Instances</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Connect Helprr to your media services and indexers.
        </p>
      </div>

      {multiInstanceConfigs.map((config) => {
        const instances = byType.get(config.type) ?? [];
        const Icon = config.icon;
        return (
          <GroupedSection key={config.type} title={config.label}>
            {instances.map((inst) => (
              <Link
                key={inst.id}
                href={`/settings/instances/${config.slug}?instance=${inst.id}`}
                className="grouped-row hover:bg-[oklch(1_0_0/3%)] active:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-md shrink-0 ${config.iconBg} ${config.iconColor}`}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span className="text-[15px] font-medium truncate">{inst.label}</span>
                  {inst.isDefault && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hpr-amber)]/15 text-[var(--hpr-amber)] shrink-0">
                      Default
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
            <Link
              href={`/settings/instances/${config.slug}?instance=new`}
              className="grouped-row text-[var(--hpr-amber)] hover:bg-[oklch(1_0_0/3%)] active:bg-white/5 transition-colors"
            >
              <span className="text-[14px]">+ Add {config.label} instance</span>
            </Link>
          </GroupedSection>
        );
      })}

      <GroupedSection
        title="Services"
        footer="Synced across devices · Validate with Test before saving"
      >
        {singleInstanceConfigs.map((config) => {
          const isConnected = (byType.get(config.type)?.length ?? 0) > 0;
          const Icon = config.icon;
          return (
            <Link
              key={config.type}
              href={`/settings/instances/${config.slug}`}
              className="grouped-row hover:bg-[oklch(1_0_0/3%)] active:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className={`flex h-8 w-8 items-center justify-center rounded-md shrink-0 ${config.iconBg} ${config.iconColor}`}>
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="text-[15px] font-medium truncate">{config.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
                  {loaded ? (isConnected ? 'Connected' : 'Not configured') : '…'}
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </Link>
          );
        })}
      </GroupedSection>

      <AnilistConnectionCard />
    </div>
  );
}
