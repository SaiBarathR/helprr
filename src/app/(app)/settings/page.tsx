'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
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
import { ChevronRight, Loader2, Film, Tv, Download, Search, MonitorPlay, CheckCircle, XCircle, Compass } from 'lucide-react';
import { NavOrderSettings } from '@/components/settings/nav-order-settings';
import { InstallAppSection } from '@/components/settings/install-app-section';

interface ServiceForm {
  url: string;
  apiKey: string;
  username: string;
  testing: boolean;
  saving: boolean;
}

interface JellyfinUserOption {
  id: string;
  name: string;
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
    icon: Film,
    dotColor: 'bg-purple-500',
    placeholder: 'http://localhost:7878',
  },
  {
    type: 'SONARR' as const,
    label: 'Sonarr',
    icon: Tv,
    dotColor: 'bg-blue-500',
    placeholder: 'http://localhost:8989',
  },
  {
    type: 'QBITTORRENT' as const,
    label: 'qBittorrent',
    icon: Download,
    dotColor: 'bg-green-500',
    placeholder: 'http://localhost:8080',
  },
  {
    type: 'PROWLARR' as const,
    label: 'Prowlarr',
    icon: Search,
    dotColor: 'bg-orange-500',
    placeholder: 'http://localhost:9696',
  },
  {
    type: 'JELLYFIN' as const,
    label: 'Jellyfin',
    icon: MonitorPlay,
    dotColor: 'bg-[#00a4dc]',
    placeholder: 'http://localhost:8096',
  },
  {
    type: 'TMDB' as const,
    label: 'TMDB',
    icon: Compass,
    dotColor: 'bg-cyan-500',
    placeholder: 'https://api.themoviedb.org/3',
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

/**
 * Renders the Settings page for managing service instances, application preferences, display theme, notification settings, and account actions.
 *
 * The component loads existing service connections and user settings on mount, exposes controls to test/save service connections, adjust polling and refresh intervals, set appearance and notification options, reorder navigation, and sign out.
 *
 * @returns A React element representing the full Settings UI.
 */
export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const [services, setServices] = useState<Record<string, ServiceForm>>({
    SONARR: { ...defaultServiceForm },
    RADARR: { ...defaultServiceForm },
    QBITTORRENT: { ...defaultServiceForm },
    PROWLARR: { ...defaultServiceForm },
    JELLYFIN: { ...defaultServiceForm },
    TMDB: { ...defaultServiceForm },
  });
  const [jellyfinValidated, setJellyfinValidated] = useState<{ userId: string } | null>(null);
  const [jellyfinUsers, setJellyfinUsers] = useState<JellyfinUserOption[]>([]);

  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState('30');
  const [dashboardRefreshInterval, setDashboardRefreshInterval] = useState('5');
  const [activityRefreshInterval, setActivityRefreshInterval] = useState('5');
  const [torrentsRefreshInterval, setTorrentsRefreshInterval] = useState('5');
  const [upcomingAlertHours, setUpcomingAlertHours] = useState('24');
  const [upcomingNotifyMode, setUpcomingNotifyMode] = useState('before_air');
  const [upcomingNotifyBeforeMins, setUpcomingNotifyBeforeMins] = useState('60');
  const [upcomingDailyNotifyHour, setUpcomingDailyNotifyHour] = useState('9');
  const [savingSettings, setSavingSettings] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

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
          let savedJellyfinUserId = '';
          for (const conn of connections) {
            if (updated[conn.type]) {
              updated[conn.type] = {
                ...updated[conn.type],
                url: conn.url,
                apiKey: conn.apiKey,
                username: conn.username || '',
              };
              if (conn.type === 'JELLYFIN') {
                savedJellyfinUserId = conn.username || '';
              }
            }
          }
          setServices(updated);

          if (savedJellyfinUserId) {
            setJellyfinValidated({ userId: savedJellyfinUserId });
          } else {
            setJellyfinValidated(null);
          }

          if (updated.JELLYFIN.url && updated.JELLYFIN.apiKey) {
            try {
              const usersRes = await fetch('/api/jellyfin/users');
              if (usersRes.ok) {
                const usersData = await usersRes.json();
                const options: JellyfinUserOption[] = Array.isArray(usersData.users)
                  ? usersData.users
                    .filter((u): u is { Id: string; Name: string; Policy?: { IsHidden?: boolean; IsDisabled?: boolean } } => (
                      !!u &&
                      typeof u === 'object' &&
                      typeof (u as { Id?: unknown }).Id === 'string' &&
                      typeof (u as { Name?: unknown }).Name === 'string'
                    ))
                    .filter((u) => !u.Policy?.IsHidden && !u.Policy?.IsDisabled)
                    .map((u) => ({ id: u.Id, name: u.Name }))
                    .sort((a, b) => a.name.localeCompare(b.name))
                  : [];

                if (savedJellyfinUserId && !options.some((u) => u.id === savedJellyfinUserId)) {
                  options.unshift({
                    id: savedJellyfinUserId,
                    name: `Saved User (${savedJellyfinUserId})`,
                  });
                }
                setJellyfinUsers(options);
              } else if (savedJellyfinUserId) {
                setJellyfinUsers([{ id: savedJellyfinUserId, name: `Saved User (${savedJellyfinUserId})` }]);
              }
            } catch {
              if (savedJellyfinUserId) {
                setJellyfinUsers([{ id: savedJellyfinUserId, name: `Saved User (${savedJellyfinUserId})` }]);
              }
            }
          } else {
            setJellyfinUsers([]);
          }
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

  async function testConnection(type: string) {
    const svc = services[type];
    const needsUsername = type === 'QBITTORRENT';

    if (!svc.url || !svc.apiKey) {
      toast.error(needsUsername ? 'Please enter URL and Password' : 'Please enter both URL and API Key');
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
          ...(type === 'QBITTORRENT' && { username: svc.username || 'admin' }),
        }),
      });

      const data = await res.json();

      if (data.success) {
        if (type === 'JELLYFIN' && data.userId) {
          const users = Array.isArray(data.users)
            ? data.users.filter((u): u is JellyfinUserOption => (
              !!u &&
              typeof u === 'object' &&
              typeof (u as { id?: unknown }).id === 'string' &&
              typeof (u as { name?: unknown }).name === 'string'
            ))
            : [];
          setJellyfinUsers(users);

          const selectedUserId = users.find((u) => u.id === svc.username)?.id
            || users.find((u) => u.id === data.userId)?.id
            || users[0]?.id
            || data.userId;
          if (selectedUserId) {
            updateService(type, 'username', selectedUserId);
            setJellyfinValidated({ userId: selectedUserId });
          } else {
            setJellyfinValidated({ userId: data.userId });
          }
        }
        toast.success(`Connection successful${data.version ? ` (v${data.version})` : ''}${data.serverName ? ` - ${data.serverName}` : ''}`, {
          icon: <CheckCircle className="h-4 w-4 text-green-500" />,
        });
      } else {
        if (type === 'JELLYFIN') {
          setJellyfinValidated(null);
          setJellyfinUsers([]);
        }
        toast.error(data.error || 'Connection failed', {
          icon: <XCircle className="h-4 w-4 text-red-500" />,
        });
      }
    } catch {
      if (type === 'JELLYFIN') {
        setJellyfinValidated(null);
        setJellyfinUsers([]);
      }
      toast.error('Failed to test connection');
    } finally {
      updateService(type, 'testing', false);
    }
  }

  async function saveConnection(type: string) {
    const svc = services[type];
    const needsUsername = type === 'QBITTORRENT';

    if (!svc.url || !svc.apiKey) {
      toast.error(needsUsername ? 'Please enter URL and Password' : 'Please enter both URL and API Key');
      return;
    }

    if (type === 'JELLYFIN' && !jellyfinValidated) {
      toast.error('Please test Jellyfin with an admin API key before saving');
      return;
    }

    if (type === 'JELLYFIN' && !svc.username) {
      toast.error('Please select a Jellyfin user');
      return;
    }

    updateService(type, 'saving', true);

    try {
      const body: Record<string, string> = { type, url: svc.url, apiKey: svc.apiKey };
      if (type === 'QBITTORRENT') {
        body.username = svc.username || 'admin';
      } else if (type === 'JELLYFIN' && jellyfinValidated) {
        body.username = svc.username || jellyfinValidated.userId;
      }

      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
        }),
      });

      if (res.ok) {
        toast.success('Settings saved');
      } else {
        const data = await res.json();
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
      {/* <h1 className="text-[28px] font-bold px-4 pt-2 pb-4">Settings</h1> */}

      {/* ── Instances ── */}
      <div className="grouped-section px-4 mb-6">
        <div className="grouped-section-title">Instances</div>
        <div className="grouped-section-content">
          {SERVICE_CONFIG.map((config, idx) => {
            const svc = services[config.type];
            const isQbt = config.type === 'QBITTORRENT';
            const isJellyfin = config.type === 'JELLYFIN';
            const showUsernamePassword = isQbt;
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
                        onChange={(e) => {
                          updateService(config.type, 'url', e.target.value);
                          if (isJellyfin) {
                            setJellyfinValidated(null);
                            setJellyfinUsers([]);
                            updateService(config.type, 'username', '');
                          }
                        }}
                        className="h-10"
                      />
                    </div>
                    {showUsernamePassword ? (
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
                      <>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">{isJellyfin ? 'API Key (Admin)' : 'API Key'}</Label>
                          <Input
                            type="password"
                            placeholder={isJellyfin ? 'Enter Jellyfin API key' : 'Enter API key'}
                            value={svc.apiKey}
                            onChange={(e) => {
                              updateService(config.type, 'apiKey', e.target.value);
                              if (isJellyfin) {
                                setJellyfinValidated(null);
                                setJellyfinUsers([]);
                                updateService(config.type, 'username', '');
                              }
                            }}
                            className="h-10"
                          />
                        </div>
                        {isJellyfin && (
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Primary Default User</Label>
                            <Select
                              value={svc.username || undefined}
                              onValueChange={(value) => updateService(config.type, 'username', value)}
                              disabled={!jellyfinValidated || jellyfinUsers.length === 0}
                            >
                              <SelectTrigger className="h-10">
                                <SelectValue placeholder={jellyfinUsers.length > 0 ? 'Select a Jellyfin user' : 'Test connection to load users'} />
                              </SelectTrigger>
                              <SelectContent>
                                {jellyfinUsers.map((user) => (
                                  <SelectItem key={user.id} value={user.id}>
                                    {user.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {isJellyfin && jellyfinValidated && (
                          <p className="text-xs text-green-500">Admin API key validated - ready to save</p>
                        )}
                        {isJellyfin && !jellyfinValidated && svc.apiKey && (
                          <p className="text-xs text-muted-foreground">Test connection to validate your API key before saving</p>
                        )}
                      </>
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

      {/* ── App Install ── */}
      <InstallAppSection />

      {/* ── Navigation ── */}
      <NavOrderSettings />

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
