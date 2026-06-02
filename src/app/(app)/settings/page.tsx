'use client';

import { useEffect, useState } from 'react';
import {
  Server,
  Sliders,
  Bell,
  HardDrive,
  ScrollText,
  Palette,
  Download as DownloadIcon,
  UserCircle,
  Shield,
  Gauge,
  Users,
} from 'lucide-react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { CategoryRow } from '@/components/settings/category-row';
import { useMe, hasCapability } from '@/components/permission-provider';

interface ServiceCount {
  configured: number;
  total: number;
}

const SERVICE_TYPES = ['SONARR', 'RADARR', 'LIDARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN', 'TMDB', 'SEERR'] as const;

export default function SettingsIndexPage() {
  const [serviceCount, setServiceCount] = useState<ServiceCount | null>(null);
  const me = useMe();
  const canInstances = hasCapability(me, 'settings.instances');

  useEffect(() => {
    if (!canInstances) return; // members can't read connections; skip the 403.
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/services');
        if (!res.ok) return;
        const data = (await res.json()) as Array<{ type?: string }>;
        const configured = Array.isArray(data)
          ? data.filter((c) => typeof c?.type === 'string' && (SERVICE_TYPES as readonly string[]).includes(c.type)).length
          : 0;
        if (!cancelled) {
          setServiceCount({ configured, total: SERVICE_TYPES.length });
        }
      } catch {
        // noop
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [canInstances]);

  const instancesSubtitle = serviceCount
    ? `${serviceCount.configured} of ${serviceCount.total} connected`
    : 'Connect Sonarr, Radarr, qBittorrent, and more';

  const canStorage = hasCapability(me, 'settings.storage');
  const canLogging = hasCapability(me, 'settings.logging');
  const canDownloads = hasCapability(me, 'settings.downloads');
  const canBackup = hasCapability(me, 'settings.backup');
  const canUsers = hasCapability(me, 'users.manage');

  return (
    <div className="animate-content-in pb-12">
      {canInstances && (
        <GroupedSection>
          <CategoryRow
            href="/settings/instances"
            icon={Server}
            iconBg="bg-amber-500/10"
            iconColor="text-amber-500"
            label="Instances"
            subtitle={instancesSubtitle}
          />
        </GroupedSection>
      )}

      {canUsers && (
        <GroupedSection>
          <CategoryRow
            href="/settings/users"
            icon={Users}
            iconBg="bg-violet-500/10"
            iconColor="text-violet-400"
            label="Users"
            subtitle="Members, roles, and permissions"
          />
        </GroupedSection>
      )}

      <GroupedSection>
        <CategoryRow
          href="/settings/preferences"
          icon={Sliders}
          iconBg="bg-sky-500/10"
          iconColor="text-sky-400"
          label="Preferences"
          subtitle="Timezone, polling, refresh intervals"
        />
        <CategoryRow
          href="/settings/notifications"
          icon={Bell}
          iconBg="bg-rose-500/10"
          iconColor="text-rose-400"
          label="Notifications"
          subtitle="Push, event types, devices, upcoming"
        />
        {canStorage && (
          <CategoryRow
            href="/settings/storage"
            icon={HardDrive}
            iconBg="bg-emerald-500/10"
            iconColor="text-emerald-400"
            label="Storage"
            subtitle="Cache and cleanup history"
          />
        )}
        {canLogging && (
          <CategoryRow
            href="/settings/logging"
            icon={ScrollText}
            iconBg="bg-indigo-500/10"
            iconColor="text-indigo-400"
            label="Logging"
            subtitle="Level, rotation, retention"
          />
        )}
        {canDownloads && (
          <CategoryRow
            href="/settings/downloads"
            icon={Gauge}
            iconBg="bg-amber-500/10"
            iconColor="text-amber-400"
            label="Downloads"
            subtitle="qBittorrent bandwidth scheduler"
          />
        )}
      </GroupedSection>

      <GroupedSection>
        <CategoryRow
          href="/settings/appearance"
          icon={Palette}
          iconBg="bg-fuchsia-500/10"
          iconColor="text-fuchsia-400"
          label="Appearance & Layout"
          subtitle="Navigation, carousels, install"
        />
      </GroupedSection>

      <GroupedSection>
        {canBackup && (
          <CategoryRow
            href="/settings/backup"
            icon={DownloadIcon}
            iconBg="bg-yellow-500/10"
            iconColor="text-yellow-400"
            label="Backup & Restore"
            subtitle="Export or import your settings"
          />
        )}
        <CategoryRow
          href="/settings/sessions"
          icon={Shield}
          iconBg="bg-orange-500/10"
          iconColor="text-orange-400"
          label="Sessions"
          subtitle="Active devices, force logout"
        />
        <CategoryRow
          href="/settings/account"
          icon={UserCircle}
          iconBg="bg-red-500/10"
          iconColor="text-red-400"
          label="Account"
          subtitle="Sign out"
        />
      </GroupedSection>
    </div>
  );
}
