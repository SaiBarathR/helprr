'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Film, Tv, Download, Loader2, CheckCircle, XCircle } from 'lucide-react';

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
    type: 'SONARR' as const,
    label: 'Sonarr',
    icon: Tv,
    iconColor: 'text-purple-500',
    iconBg: 'bg-purple-500/10',
    placeholder: 'http://localhost:8989',
  },
  {
    type: 'RADARR' as const,
    label: 'Radarr',
    icon: Film,
    iconColor: 'text-blue-500',
    iconBg: 'bg-blue-500/10',
    placeholder: 'http://localhost:7878',
  },
  {
    type: 'QBITTORRENT' as const,
    label: 'qBittorrent',
    icon: Download,
    iconColor: 'text-green-500',
    iconBg: 'bg-green-500/10',
    placeholder: 'http://localhost:8080',
  },
] as const;

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const [services, setServices] = useState<Record<string, ServiceForm>>({
    SONARR: { ...defaultServiceForm },
    RADARR: { ...defaultServiceForm },
    QBITTORRENT: { ...defaultServiceForm },
  });

  const [pollingInterval, setPollingInterval] = useState('30');
  const [upcomingAlertHours, setUpcomingAlertHours] = useState('24');
  const [savingSettings, setSavingSettings] = useState(false);

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Service Connections */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Service Connections</h2>

        {SERVICE_CONFIG.map((config) => {
          const svc = services[config.type];
          const Icon = config.icon;
          const isQbt = config.type === 'QBITTORRENT';

          return (
            <Card key={config.type}>
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <div className={`rounded-lg ${config.iconBg} p-2`}>
                  <Icon className={`h-5 w-5 ${config.iconColor}`} />
                </div>
                <CardTitle className="text-base">{config.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor={`${config.type}-url`}>URL</Label>
                  <Input
                    id={`${config.type}-url`}
                    placeholder={config.placeholder}
                    value={svc.url}
                    onChange={(e) => updateService(config.type, 'url', e.target.value)}
                  />
                </div>
                {isQbt ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor={`${config.type}-username`}>Username</Label>
                      <Input
                        id={`${config.type}-username`}
                        placeholder="admin"
                        value={svc.username}
                        onChange={(e) => updateService(config.type, 'username', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${config.type}-password`}>Password</Label>
                      <Input
                        id={`${config.type}-password`}
                        type="password"
                        placeholder="Enter password"
                        value={svc.apiKey}
                        onChange={(e) => updateService(config.type, 'apiKey', e.target.value)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor={`${config.type}-apikey`}>API Key</Label>
                    <Input
                      id={`${config.type}-apikey`}
                      type="password"
                      placeholder="Enter API key"
                      value={svc.apiKey}
                      onChange={(e) => updateService(config.type, 'apiKey', e.target.value)}
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testConnection(config.type)}
                    disabled={svc.testing || svc.saving}
                  >
                    {svc.testing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      'Test'
                    )}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveConnection(config.type)}
                    disabled={svc.testing || svc.saving}
                  >
                    {svc.saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      {/* General Settings */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">General Settings</h2>

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="space-y-2">
              <Label>Polling Interval</Label>
              <Select value={pollingInterval} onValueChange={setPollingInterval}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select interval" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 seconds</SelectItem>
                  <SelectItem value="30">30 seconds</SelectItem>
                  <SelectItem value="60">60 seconds</SelectItem>
                  <SelectItem value="120">120 seconds</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Theme</Label>
              <Select value={mounted ? theme : undefined} onValueChange={setTheme}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Upcoming Alert Hours</Label>
              <Select value={upcomingAlertHours} onValueChange={setUpcomingAlertHours}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select hours" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6 hours</SelectItem>
                  <SelectItem value="12">12 hours</SelectItem>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="48">48 hours</SelectItem>
                  <SelectItem value="72">72 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
