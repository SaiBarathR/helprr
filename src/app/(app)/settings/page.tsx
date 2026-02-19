'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CheckCircle,
  ChevronRight,
  GripVertical,
  Loader2,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useNavConfig } from '@/components/layout/nav-config-provider';
import { NAV_ICON_MAP } from '@/components/layout/nav-icons';
import { cn } from '@/lib/utils';
import {
  buildEffectiveNav,
  CONFIGURABLE_NAV_PAGE_IDS,
  getNavItem,
  normalizeNavConfig,
  resolveConfigurableNavPageForPath,
  type NavConfigV1,
  type NavPageId,
} from '@/lib/navigation-config';

interface ServiceForm {
  url: string;
  apiKey: string;
  username: string;
  testing: boolean;
  saving: boolean;
}

interface SortableNavRowProps {
  id: NavPageId;
  enabled: boolean;
  disableToggle: boolean;
  onToggle: (id: NavPageId, enabled: boolean) => void;
}

function SortableNavRow({ id, enabled, disableToggle, onToggle }: SortableNavRowProps) {
  const item = getNavItem(id);
  const Icon = NAV_ICON_MAP[item.iconKey];
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2',
        isDragging && 'border-primary/60 bg-accent shadow-sm'
      )}
    >
      <button
        type="button"
        className="touch-target h-9 w-9 rounded-md text-muted-foreground hover:bg-accent"
        aria-label={`Reorder ${item.label}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm font-medium">{item.label}</span>
      <Switch
        checked={enabled}
        onCheckedChange={(checked) => onToggle(id, checked)}
        disabled={disableToggle && enabled}
        aria-label={`Toggle ${item.label}`}
      />
    </div>
  );
}

const defaultServiceForm: ServiceForm = {
  url: '',
  apiKey: '',
  username: '',
  testing: false,
  saving: false,
};

const SERVICE_CONFIG = [
  {
    type: 'RADARR' as const,
    label: 'Radarr',
    dotColor: 'bg-purple-500',
    placeholder: 'http://localhost:7878',
  },
  {
    type: 'SONARR' as const,
    label: 'Sonarr',
    dotColor: 'bg-blue-500',
    placeholder: 'http://localhost:8989',
  },
  {
    type: 'QBITTORRENT' as const,
    label: 'qBittorrent',
    dotColor: 'bg-green-500',
    placeholder: 'http://localhost:8080',
  },
  {
    type: 'PROWLARR' as const,
    label: 'Prowlarr',
    dotColor: 'bg-orange-500',
    placeholder: 'http://localhost:9696',
  },
] as const;

const POLLING_OPTIONS = [
  { value: '15', label: '15 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '60 seconds' },
  { value: '120', label: '120 seconds' },
];

const REFRESH_OPTIONS = [
  { value: '2', label: '2 seconds' },
  { value: '5', label: '5 seconds' },
  { value: '10', label: '10 seconds' },
  { value: '15', label: '15 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '1 minute' },
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
  { value: '600', label: '10 minutes' },
];

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

const ALERT_WINDOW_OPTIONS = [
  { value: '6', label: '6 hours' },
  { value: '12', label: '12 hours' },
  { value: '24', label: '24 hours' },
  { value: '48', label: '48 hours' },
  { value: '72', label: '72 hours' },
];

const TIMING_OPTIONS = [
  { value: 'before_air', label: 'Before air time' },
  { value: 'once_in_window', label: 'Once when entering window' },
  { value: 'daily_digest', label: 'Daily digest' },
];

const NOTIFY_BEFORE_OPTIONS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
  { value: '360', label: '6 hours' },
  { value: '720', label: '12 hours' },
  { value: '1440', label: '24 hours' },
];

export default function SettingsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { navConfig: sharedNavConfig, setNavConfig: setSharedNavConfig } = useNavConfig();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const [services, setServices] = useState<Record<string, ServiceForm>>({
    SONARR: { ...defaultServiceForm },
    RADARR: { ...defaultServiceForm },
    QBITTORRENT: { ...defaultServiceForm },
    PROWLARR: { ...defaultServiceForm },
  });

  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState('30');
  const [dashboardRefreshInterval, setDashboardRefreshInterval] = useState('5');
  const [activityRefreshInterval, setActivityRefreshInterval] = useState('5');
  const [torrentsRefreshInterval, setTorrentsRefreshInterval] = useState('5');
  const [upcomingAlertHours, setUpcomingAlertHours] = useState('24');
  const [upcomingNotifyMode, setUpcomingNotifyMode] = useState('before_air');
  const [upcomingNotifyBeforeMins, setUpcomingNotifyBeforeMins] = useState('60');
  const [upcomingDailyNotifyHour, setUpcomingDailyNotifyHour] = useState('9');
  const [navConfig, setNavConfig] = useState<NavConfigV1>(sharedNavConfig);
  const [savingSettings, setSavingSettings] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const enabledConfigurableCount = useMemo(
    () => CONFIGURABLE_NAV_PAGE_IDS.filter((id) => navConfig.enabled[id]).length,
    [navConfig]
  );

  const navPreview = useMemo(() => buildEffectiveNav(navConfig), [navConfig]);

  useEffect(() => {
    setNavConfig(sharedNavConfig);
  }, [sharedNavConfig]);

  useEffect(() => {
    async function loadData() {
      try {
        const [connectionsRes, settingsRes] = await Promise.allSettled([
          fetch('/api/services'),
          fetch('/api/settings'),
        ]);

        if (connectionsRes.status === 'fulfilled' && connectionsRes.value.ok) {
          const connections = await connectionsRes.value.json();
          const updated = { ...services };
          for (const conn of connections) {
            if (updated[conn.type]) {
              updated[conn.type] = {
                ...updated[conn.type],
                url: conn.url,
                apiKey: conn.apiKey,
                username: conn.username || '',
              };
            }
          }
          setServices(updated);
        }

        if (settingsRes.status === 'fulfilled' && settingsRes.value.ok) {
          const settings = await settingsRes.value.json();
          setPollingInterval(String(settings.pollingIntervalSecs));
          setDashboardRefreshInterval(String(settings.dashboardRefreshIntervalSecs ?? 5));
          setActivityRefreshInterval(String(settings.activityRefreshIntervalSecs ?? 5));
          setTorrentsRefreshInterval(String(settings.torrentsRefreshIntervalSecs ?? 5));
          setUpcomingAlertHours(String(settings.upcomingAlertHours));
          if (settings.upcomingNotifyMode) setUpcomingNotifyMode(settings.upcomingNotifyMode);
          if (settings.upcomingNotifyBeforeMins != null) setUpcomingNotifyBeforeMins(String(settings.upcomingNotifyBeforeMins));
          if (settings.upcomingDailyNotifyHour != null) setUpcomingDailyNotifyHour(String(settings.upcomingDailyNotifyHour));
          if (settings.theme) {
            setTheme(settings.theme);
          }

          const normalized = normalizeNavConfig(settings.navConfig);
          setNavConfig(normalized);
          setSharedNavConfig(normalized);
        }
      } catch {
        // Settings may not exist yet
      }
    }

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateService(type: string, field: keyof ServiceForm, value: string | boolean) {
    setServices((prev) => ({
      ...prev,
      [type]: { ...prev[type], [field]: value },
    }));
  }

  function isConfigured(type: string) {
    const svc = services[type];
    return !!(svc.url && svc.apiKey);
  }

  function handleNavToggle(id: NavPageId, enabled: boolean) {
    if (!enabled && enabledConfigurableCount <= 1) {
      toast.error('At least one page must remain enabled');
      return;
    }

    setNavConfig((prev) => ({
      ...prev,
      enabled: {
        ...prev.enabled,
        [id]: enabled,
      },
    }));
  }

  function handleNavDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = String(active.id) as NavPageId;
    const overId = String(over.id) as NavPageId;

    setNavConfig((prev) => {
      const oldIndex = prev.order.indexOf(activeId);
      const newIndex = prev.order.indexOf(overId);

      if (oldIndex < 0 || newIndex < 0) {
        return prev;
      }

      return {
        ...prev,
        order: arrayMove(prev.order, oldIndex, newIndex),
      };
    });
  }

  async function testConnection(type: string) {
    const svc = services[type];
    const isQbt = type === 'QBITTORRENT';

    if (!svc.url || !svc.apiKey) {
      toast.error(isQbt ? 'Please enter URL and Password' : 'Please enter both URL and API Key');
      return;
    }

    updateService(type, 'testing', true);

    try {
      const res = await fetch('/api/services/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          url: svc.url,
          apiKey: svc.apiKey,
          ...(isQbt && { username: svc.username || 'admin' }),
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(`Connection successful${data.version ? ` (v${data.version})` : ''}`, {
          icon: <CheckCircle className="h-4 w-4 text-green-500" />,
        });
      } else {
        toast.error(data.error || 'Connection failed', {
          icon: <XCircle className="h-4 w-4 text-red-500" />,
        });
      }
    } catch {
      toast.error('Failed to test connection');
    } finally {
      updateService(type, 'testing', false);
    }
  }

  async function saveConnection(type: string) {
    const svc = services[type];
    const isQbt = type === 'QBITTORRENT';

    if (!svc.url || !svc.apiKey) {
      toast.error(isQbt ? 'Please enter URL and Password' : 'Please enter both URL and API Key');
      return;
    }

    updateService(type, 'saving', true);

    try {
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          url: svc.url,
          apiKey: svc.apiKey,
          ...(isQbt && { username: svc.username || 'admin' }),
        }),
      });

      if (res.ok) {
        toast.success('Connection saved');
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to save connection');
      }
    } catch {
      toast.error('Failed to save connection');
    } finally {
      updateService(type, 'saving', false);
    }
  }

  async function saveGeneralSettings() {
    if (enabledConfigurableCount < 1) {
      toast.error('At least one page must remain enabled');
      return;
    }

    setSavingSettings(true);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pollingIntervalSecs: parseInt(pollingInterval, 10),
          dashboardRefreshIntervalSecs: parseInt(dashboardRefreshInterval, 10),
          activityRefreshIntervalSecs: parseInt(activityRefreshInterval, 10),
          torrentsRefreshIntervalSecs: parseInt(torrentsRefreshInterval, 10),
          theme,
          upcomingAlertHours: parseInt(upcomingAlertHours, 10),
          upcomingNotifyMode,
          upcomingNotifyBeforeMins: parseInt(upcomingNotifyBeforeMins, 10),
          upcomingDailyNotifyHour: parseInt(upcomingDailyNotifyHour, 10),
          navConfig,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        const nextNavConfig = normalizeNavConfig(data?.navConfig ?? navConfig);
        setNavConfig(nextNavConfig);
        setSharedNavConfig(nextNavConfig);

        const currentPage = resolveConfigurableNavPageForPath(pathname);
        if (currentPage && !nextNavConfig.enabled[currentPage]) {
          router.replace(buildEffectiveNav(nextNavConfig).fallbackHref);
        }

        toast.success('Settings saved');
      } else {
        toast.error(data.error || 'Failed to save settings');
      }
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        router.push('/login');
      } else {
        toast.error('Failed to sign out');
        setSigningOut(false);
      }
    } catch {
      toast.error('Failed to sign out');
      setSigningOut(false);
    }
  }

  function getPollingLabel(value: string) {
    return POLLING_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function getRefreshLabel(value: string) {
    return REFRESH_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function getThemeLabel(value: string | undefined) {
    if (!value) return 'System';
    return THEME_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function getAlertWindowLabel(value: string) {
    return ALERT_WINDOW_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function getTimingLabel(value: string) {
    return TIMING_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function getNotifyBeforeLabel(value: string) {
    return NOTIFY_BEFORE_OPTIONS.find((o) => o.value === value)?.label ?? value;
  }

  function getDailyDigestLabel(value: string) {
    const h = parseInt(value, 10);
    if (h === 0) return '12:00 AM';
    if (h < 12) return `${h}:00 AM`;
    if (h === 12) return '12:00 PM';
    return `${h - 12}:00 PM`;
  }

  return (
    <div className="pb-8">
      {/* ── Instances ── */}
      <div className="grouped-section px-4 mb-6">
        <div className="grouped-section-title">Instances</div>
        <div className="grouped-section-content">
          {SERVICE_CONFIG.map((config, idx) => {
            const svc = services[config.type];
            const isQbt = config.type === 'QBITTORRENT';
            const configured = isConfigured(config.type);
            const expanded = expandedService === config.type;

            return (
              <div key={config.type}>
                <button
                  onClick={() => setExpandedService(expanded ? null : config.type)}
                  className="grouped-row w-full active:bg-white/5 transition-colors"
                  style={idx === SERVICE_CONFIG.length - 1 && !expanded ? { borderBottom: 'none' } : undefined}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-2.5 h-2.5 rounded-full ${config.dotColor}`} />
                    <span className="text-sm font-medium">{config.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {configured ? 'Connected' : 'Not configured'}
                    </span>
                    <ChevronRight
                      className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
                    />
                  </div>
                </button>

                {expanded && (
                  <div className="px-4 pb-4 space-y-3 border-b border-[oklch(1_0_0/6%)] last:border-b-0">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">URL</Label>
                      <Input
                        placeholder={config.placeholder}
                        value={svc.url}
                        onChange={(e) => updateService(config.type, 'url', e.target.value)}
                        className="h-10"
                      />
                    </div>
                    {isQbt ? (
                      <>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Username</Label>
                          <Input
                            placeholder="admin"
                            value={svc.username}
                            onChange={(e) => updateService(config.type, 'username', e.target.value)}
                            className="h-10"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Password</Label>
                          <Input
                            type="password"
                            placeholder="Enter password"
                            value={svc.apiKey}
                            onChange={(e) => updateService(config.type, 'apiKey', e.target.value)}
                            className="h-10"
                          />
                        </div>
                      </>
                    ) : (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">API Key</Label>
                        <Input
                          type="password"
                          placeholder="Enter API key"
                          value={svc.apiKey}
                          onChange={(e) => updateService(config.type, 'apiKey', e.target.value)}
                          className="h-10"
                        />
                      </div>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-9"
                        onClick={() => testConnection(config.type)}
                        disabled={svc.testing || svc.saving}
                      >
                        {svc.testing ? (
                          <>
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            Testing...
                          </>
                        ) : (
                          'Test'
                        )}
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 h-9"
                        onClick={() => saveConnection(config.type)}
                        disabled={svc.testing || svc.saving}
                      >
                        {svc.saving ? (
                          <>
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          'Save'
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Preferences ── */}
      <div className="grouped-section px-4 mb-6">
        <div className="grouped-section-title">Preferences</div>
        <div className="grouped-section-content">
          <div className="grouped-row">
            <span className="text-sm">Polling</span>
            <Select value={pollingInterval} onValueChange={(v) => { setPollingInterval(v); }}>
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue>{getPollingLabel(pollingInterval)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {POLLING_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grouped-row">
            <span className="text-sm">Dashboard Refresh</span>
            <Select value={dashboardRefreshInterval} onValueChange={setDashboardRefreshInterval}>
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue>{getRefreshLabel(dashboardRefreshInterval)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REFRESH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grouped-row">
            <span className="text-sm">Activity Refresh</span>
            <Select value={activityRefreshInterval} onValueChange={setActivityRefreshInterval}>
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue>{getRefreshLabel(activityRefreshInterval)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REFRESH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grouped-row">
            <span className="text-sm">Torrents Refresh</span>
            <Select value={torrentsRefreshInterval} onValueChange={setTorrentsRefreshInterval}>
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue>{getRefreshLabel(torrentsRefreshInterval)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REFRESH_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Navigation ── */}
      <div className="grouped-section px-4 mb-6">
        <div className="grouped-section-title">Navigation</div>
        <div className="grouped-section-content p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-background/40 p-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Order and visibility</p>
                  <p className="text-xs text-muted-foreground">Drag rows to reorder. Toggle pages to show or hide.</p>
                </div>
                <span className="text-[11px] text-muted-foreground">Settings is always visible</span>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleNavDragEnd}
              >
                <SortableContext
                  items={navConfig.order}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {navConfig.order.map((id) => (
                      <SortableNavRow
                        key={id}
                        id={id}
                        enabled={navConfig.enabled[id]}
                        disableToggle={enabledConfigurableCount === 1}
                        onToggle={handleNavToggle}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            <div className="rounded-xl border border-border/70 bg-background/40 p-3">
              <p className="text-sm font-medium">Preview</p>
              <p className="text-xs text-muted-foreground">This order is used for both sidebar and bottom navigation.</p>

              <div className="mt-3 space-y-3">
                <div className="rounded-md border border-border/60 bg-card p-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sidebar order</p>
                  <div className="mt-2 space-y-1">
                    {navPreview.sidebarItems.map((item) => {
                      const Icon = NAV_ICON_MAP[item.iconKey];
                      return (
                        <div key={`sidebar-preview-${item.id}`} className="flex min-h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground">
                          <Icon className="h-3.5 w-3.5" />
                          <span>{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-md border border-border/60 bg-card p-2.5">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bottom navigation</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {navPreview.bottomItems.map((item) => (
                      <span key={`bottom-preview-${item.id}`} className="inline-flex min-h-7 items-center rounded-md bg-accent px-2.5 text-xs font-medium text-foreground">
                        {item.label}
                      </span>
                    ))}
                    {navPreview.moreItems.length > 0 ? (
                      <span className="inline-flex min-h-7 items-center rounded-md bg-primary/10 px-2.5 text-xs font-medium text-primary">More</span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Direct tabs: {navPreview.bottomItems.length}/4.
                    {navPreview.moreItems.length > 0
                      ? ` ${navPreview.moreItems.length} item${navPreview.moreItems.length > 1 ? 's' : ''} inside More.`
                      : ' No overflow items.'}
                  </p>

                  {navPreview.moreItems.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">More menu</p>
                      {navPreview.moreItems.map((item) => {
                        const Icon = NAV_ICON_MAP[item.iconKey];
                        return (
                          <div key={`more-preview-${item.id}`} className="flex min-h-8 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground">
                            <Icon className="h-3.5 w-3.5" />
                            <span>{item.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Display ── */}
      <div className="grouped-section px-4 mb-6">
        <div className="grouped-section-title">Display</div>
        <div className="grouped-section-content">
          <div className="grouped-row">
            <span className="text-sm">Appearance</span>
            <Select value={mounted ? theme : undefined} onValueChange={setTheme}>
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue>{mounted ? getThemeLabel(theme) : 'System'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {THEME_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Notifications ── */}
      <div className="grouped-section px-4 mb-6">
        <div className="grouped-section-title">Notifications</div>
        <div className="grouped-section-content">
          <div className="grouped-row">
            <span className="text-sm">Alert Window</span>
            <Select value={upcomingAlertHours} onValueChange={setUpcomingAlertHours}>
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue>{getAlertWindowLabel(upcomingAlertHours)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ALERT_WINDOW_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grouped-row">
            <span className="text-sm">Timing</span>
            <Select value={upcomingNotifyMode} onValueChange={setUpcomingNotifyMode}>
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue>{getTimingLabel(upcomingNotifyMode)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TIMING_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {upcomingNotifyMode === 'before_air' && (
            <div className="grouped-row">
              <span className="text-sm">Notify Before</span>
              <Select value={upcomingNotifyBeforeMins} onValueChange={setUpcomingNotifyBeforeMins}>
                <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                  <SelectValue>{getNotifyBeforeLabel(upcomingNotifyBeforeMins)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {NOTIFY_BEFORE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {upcomingNotifyMode === 'daily_digest' && (
            <div className="grouped-row">
              <span className="text-sm">Digest Time</span>
              <Select value={upcomingDailyNotifyHour} onValueChange={setUpcomingDailyNotifyHour}>
                <SelectTrigger className="w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                  <SelectValue>{getDailyDigestLabel(upcomingDailyNotifyHour)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* ── Save Settings Button ── */}
      <div className="px-4 mb-6">
        <Button
          className="w-full h-11"
          onClick={saveGeneralSettings}
          disabled={savingSettings}
        >
          {savingSettings ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </Button>
      </div>

      {/* ── Account ── */}
      <div className="grouped-section px-4 mb-6">
        <div className="grouped-section-title">Account</div>
        <div className="grouped-section-content">
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="grouped-row w-full active:bg-white/5 transition-colors"
            style={{ borderBottom: 'none' }}
          >
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span className="text-sm font-medium text-red-500">
                {signingOut ? 'Signing Out...' : 'Sign Out'}
              </span>
            </div>
            {signingOut && <Loader2 className="h-4 w-4 animate-spin text-red-500" />}
          </button>
        </div>
      </div>
    </div>
  );
}
