'use client';

import { useState } from 'react';
import type { JellyfinDevice } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { SectionHeader, HPR, FONT_MONO, ViewModeToggle } from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';
import { DeviceItem, DevicesSeeAllDrawer } from '@/components/jellyfin/device-item';

const ROW_HEIGHT = 56;
const CAROUSEL_MAX = 15;

interface DevicesData {
  devices: JellyfinDevice[];
  selfDeviceId: string;
}

async function fetchDevicesData(): Promise<DevicesData> {
  const res = await fetch('/api/jellyfin/devices');
  if (!res.ok) return { devices: [], selfDeviceId: '' };
  const data = await res.json();
  return {
    devices: Array.isArray(data.devices) ? data.devices : [],
    selfDeviceId: data.selfDeviceId || '',
  };
}

export function JellyfinDevicesWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
  layoutVariant,
  instanceId,
  mobileGrid = false,
}: WidgetProps) {
  const { ref, height } = useElementSize<HTMLDivElement>();
  const { visibleCount } = useListFetchSize({ height, rowHeight: ROW_HEIGHT });
  const { setWidgetLayoutOverride } = useDashboardLayout();
  const [seeAll, setSeeAll] = useState(false);
  const { data, loading } = useWidgetData<DevicesData>({
    fetchFn: fetchDevicesData,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'jellyfin-devices',
  });
  const devices = data?.devices ?? [];
  const selfDeviceId = data?.selfDeviceId ?? '';

  const useList = narrow || layoutVariant === 'list';
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;
  const headerRight = (
    <>
      {toggleNode}
      {devices.length > 0 && (
        <button
          type="button"
          onClick={() => { if (!editMode) setSeeAll(true); }}
          style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: editMode ? 'default' : 'pointer', padding: 0 }}
        >
          <span className="@max-[219px]/cell:hidden">See all </span>→
        </button>
      )}
    </>
  );

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader
        title="Devices"
        badge={devices.length > 0 ? <span style={{ fontSize: 11, color: HPR.fgSubtle, fontFamily: FONT_MONO }}>{devices.length}</span> : undefined}
        right={headerRight}
      />
      {loading && devices.length === 0 ? (
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      ) : devices.length === 0 ? (
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>No devices</div>
      ) : useList ? (
        <div className="no-scrollbar scroll-fade-y" style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {devices.slice(0, visibleCount).map((device) => (
            <DeviceItem key={device.Id} device={device} variant="row" isSelf={device.Id === selfDeviceId} />
          ))}
        </div>
      ) : (
        <div className="no-scrollbar" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
          {devices.slice(0, CAROUSEL_MAX).map((device) => (
            <DeviceItem key={device.Id} device={device} variant="card" isSelf={device.Id === selfDeviceId} />
          ))}
        </div>
      )}
      <DevicesSeeAllDrawer open={seeAll} onOpenChange={setSeeAll} devices={devices} selfDeviceId={selfDeviceId} />
    </div>
  );
}
