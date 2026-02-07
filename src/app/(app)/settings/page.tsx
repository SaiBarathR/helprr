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
import { ChevronRight, Loader2, LogOut, Film, Tv, Download, CheckCircle, XCircle } from 'lucide-react';

interface ServiceForm {
  url: string;
  apiKey: string;
  username: string;
  testing: boolean;
  saving: boolean;
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
] as const;

const POLLING_OPTIONS = [
  { value: '15', label: '15 seconds' },
  { value: '30', label: '30 seconds' },
  { value: '60', label: '60 seconds' },
  { value: '120', label: '120 seconds' },
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
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const [services, setServices] = useState<Record<string, ServiceForm>>({
    SONARR: { ...defaultServiceForm },
    RADARR: { ...defaultServiceForm },
    QBITTORRENT: { ...defaultServiceForm },
  });

  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState('30');
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
    setSavingSettings(true);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pollingIntervalSecs: parseInt(pollingInterval, 10),
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
      <h1 className="text-[28px] font-bold px-4 pt-2 pb-4">Settings</h1>

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
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent p-0 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
                <SelectValue>{getPollingLabel(pollingInterval)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {POLLING_OPTIONS.map((o) => (
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
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent p-0 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
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
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent p-0 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
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
              <SelectTrigger className="w-auto h-auto border-0 bg-transparent p-0 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
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
                <SelectTrigger className="w-auto h-auto border-0 bg-transparent p-0 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
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
                <SelectTrigger className="w-auto h-auto border-0 bg-transparent p-0 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5">
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
