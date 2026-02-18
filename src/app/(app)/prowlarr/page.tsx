'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  RefreshCw,
  Loader2,
  Trash2,
  CheckCircle,
  XCircle,
  Search,
  ChevronLeft,
  Rss,
  Download,
  Database,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type {
  ProwlarrIndexer,
  ProwlarrIndexerStatus,
  ProwlarrIndexerStat,
  ProwlarrHistoryRecord,
  ProwlarrStats,
  ProwlarrUserAgentStat,
} from '@/lib/prowlarr-client';

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function categoryLabel(id: number | string): string {
  const num = typeof id === 'string' ? parseInt(id, 10) : id;
  const first = Math.floor(num / 1000);
  const map: Record<number, string> = { 2: 'Movies', 3: 'Audio', 5: 'TV', 6: 'XXX', 7: 'Books', 8: 'Other' };
  return map[first] ?? String(num);
}

function categoryColor(id: number | string): string {
  const num = typeof id === 'string' ? parseInt(id, 10) : id;
  const first = Math.floor(num / 1000);
  const map: Record<number, string> = {
    2: 'bg-blue-500/20 text-blue-400',
    3: 'bg-purple-500/20 text-purple-400',
    5: 'bg-green-500/20 text-green-400',
    6: 'bg-pink-500/20 text-pink-400',
    7: 'bg-amber-500/20 text-amber-400',
    8: 'bg-muted text-muted-foreground',
  };
  return map[first] ?? 'bg-muted text-muted-foreground';
}

function IndexerStatusDot({ indexer, statuses }: { indexer: ProwlarrIndexer; statuses: ProwlarrIndexerStatus[] }) {
  if (!indexer.enable) {
    return <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" title="Disabled" />;
  }
  const status = statuses.find((s) => s.providerId === indexer.id);
  if (status && status.disabledTill) {
    return <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title="Blocked" />;
  }
  return <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Enabled" />;
}

// ── Add Indexer Modal ────────────────────────────────────────────────────────

interface AddIndexerModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

function AddIndexerModal({ open, onClose, onAdded }: AddIndexerModalProps) {
  const [schemas, setSchemas] = useState<ProwlarrIndexer[]>([]);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const [defaultAppProfileId, setDefaultAppProfileId] = useState<number>(1);
  const [search, setSearch] = useState('');
  const [filterProtocol, setFilterProtocol] = useState<'all' | 'torrent' | 'usenet'>('all');
  const [filterPrivacy, setFilterPrivacy] = useState<'all' | 'public' | 'private' | 'semiPrivate'>('all');
  const [filterLanguage, setFilterLanguage] = useState<string>('all');
  const [selected, setSelected] = useState<ProwlarrIndexer | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [enableIndexer, setEnableIndexer] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSchemasLoading(true);
    // Fetch schemas and app profiles in parallel. App profiles give us the required
    // appProfileId (Prowlarr rejects appProfileId=0 with a validation error).
    Promise.all([
      fetch('/api/prowlarr/schema').then((r) => r.json()),
      fetch('/api/prowlarr/appprofile').then((r) => r.json()),
    ])
      .then(([schemaData, profileData]) => {
        if (Array.isArray(schemaData)) setSchemas(schemaData);
        if (Array.isArray(profileData) && profileData.length > 0) {
          setDefaultAppProfileId(profileData[0].id);
        }
      })
      .catch(() => toast.error('Failed to load indexer schemas'))
      .finally(() => setSchemasLoading(false));
  }, [open]);

  function handleClose() {
    setSelected(null);
    setFieldValues({});
    setSearch('');
    setFilterProtocol('all');
    setFilterPrivacy('all');
    setFilterLanguage('all');
    setEnableIndexer(true);
    setDefaultAppProfileId(1);
    onClose();
  }

  function selectSchema(schema: ProwlarrIndexer) {
    const defaults: Record<string, unknown> = {};
    for (const field of schema.fields) {
      if (!field.advanced) {
        defaults[field.name] = field.value ?? '';
      }
    }
    setFieldValues(defaults);
    setEnableIndexer(true);
    setSelected(schema);
  }

  async function handleSubmit() {
    if (!selected) return;
    setSubmitting(true);
    try {
      // Strip display-only schema fields (language, description, categories) that
      // Prowlarr's POST /api/v1/indexer endpoint does not accept and rejects with 422.
      // appProfileId must be > 0; use the fetched default (first available profile).
      const appProfileId = (selected.appProfileId && selected.appProfileId > 0)
        ? selected.appProfileId
        : defaultAppProfileId;
      const body = {
        id: 0,
        name: selected.name,
        enable: enableIndexer,
        appProfileId,
        protocol: selected.protocol,
        privacy: selected.privacy,
        priority: selected.priority,
        tags: selected.tags,
        implementationName: selected.implementationName,
        implementation: selected.implementation,
        configContract: selected.configContract,
        infoLink: selected.infoLink,
        supportsRss: selected.supportsRss,
        supportsSearch: selected.supportsSearch,
        fields: selected.fields.map((f) => ({
          name: f.name,
          value: fieldValues[f.name] !== undefined ? fieldValues[f.name] : f.value,
        })),
      };
      const res = await fetch('/api/prowlarr/indexers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success('Indexer added successfully');
        onAdded();
        handleClose();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to add indexer');
      }
    } catch {
      toast.error('Failed to add indexer');
    } finally {
      setSubmitting(false);
    }
  }

  const languages = ['all', ...Array.from(new Set(schemas.map((s) => s.language).filter(Boolean))) as string[]];

  const filteredSchemas = schemas.filter((s) => {
    if (!s.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterProtocol !== 'all' && s.protocol !== filterProtocol) return false;
    if (filterPrivacy !== 'all' && s.privacy !== filterPrivacy) return false;
    if (filterLanguage !== 'all' && s.language !== filterLanguage) return false;
    return true;
  });

  const visibleFields = selected?.fields.filter((f) => !f.advanced) ?? [];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {selected && (
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-accent rounded">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {selected ? selected.name : 'Add Indexer'}
          </DialogTitle>
          {!selected && (
            <DialogDescription>Search and select an indexer to add.</DialogDescription>
          )}
        </DialogHeader>

        {!selected ? (
          <div className="flex flex-col gap-3 overflow-hidden">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search indexers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Filters */}
            <div className="flex gap-2 flex-wrap">
              <select
                value={filterProtocol}
                onChange={(e) => setFilterProtocol(e.target.value as typeof filterProtocol)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="all">All Protocols</option>
                <option value="torrent">Torrent</option>
                <option value="usenet">Usenet</option>
              </select>
              <select
                value={filterPrivacy}
                onChange={(e) => setFilterPrivacy(e.target.value as typeof filterPrivacy)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="all">All Privacy</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
                <option value="semiPrivate">Semi-Private</option>
              </select>
              {languages.length > 2 && (
                <select
                  value={filterLanguage}
                  onChange={(e) => setFilterLanguage(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {languages.map((l) => (
                    <option key={l} value={l}>{l === 'all' ? 'All Languages' : l}</option>
                  ))}
                </select>
              )}
            </div>

            {/* List */}
            <div className="overflow-y-auto flex-1 space-y-0.5 max-h-[50vh]">
              {schemasLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredSchemas.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No indexers found.</p>
              ) : (
                filteredSchemas.map((schema) => (
                  <button
                    key={schema.implementation + schema.name}
                    onClick={() => selectSchema(schema)}
                    className="w-full flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-accent text-left transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium">{schema.name}</span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${schema.protocol === 'torrent' ? 'border-green-500/50 text-green-400' : 'border-blue-500/50 text-blue-400'}`}
                        >
                          {schema.protocol}
                        </Badge>
                        {schema.privacy && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 ${schema.privacy === 'public' ? 'border-green-500/50 text-green-400' :
                                schema.privacy === 'private' ? 'border-red-500/50 text-red-400' :
                                  'border-amber-500/50 text-amber-400'
                              }`}
                          >
                            {schema.privacy}
                          </Badge>
                        )}
                        {schema.language && (
                          <span className="text-[10px] text-muted-foreground">{schema.language}</span>
                        )}
                      </div>
                      {schema.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{schema.description}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              {filteredSchemas.length} indexer{filteredSchemas.length !== 1 ? 's' : ''} available
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 overflow-y-auto flex-1">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <Label className="text-sm">Enable Indexer</Label>
              <Switch checked={enableIndexer} onCheckedChange={setEnableIndexer} />
            </div>

            <div className="space-y-3">
              {visibleFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">No configuration fields required.</p>
              ) : (
                visibleFields.map((field) => (
                  <div key={field.name} className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">{field.label}</Label>
                    {field.type === 'checkbox' ? (
                      <div className="flex items-center">
                        <Switch
                          checked={Boolean(fieldValues[field.name])}
                          onCheckedChange={(v) =>
                            setFieldValues((prev) => ({ ...prev, [field.name]: v }))
                          }
                        />
                      </div>
                    ) : field.type === 'select' && field.selectOptions ? (
                      <select
                        value={String(fieldValues[field.name] ?? '')}
                        onChange={(e) =>
                          setFieldValues((prev) => ({ ...prev, [field.name]: parseInt(e.target.value, 10) }))
                        }
                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {field.selectOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                        value={String(fieldValues[field.name] ?? '')}
                        onChange={(e) =>
                          setFieldValues((prev) => ({
                            ...prev,
                            [field.name]: field.type === 'number' ? Number(e.target.value) : e.target.value,
                          }))
                        }
                        className="h-10"
                      />
                    )}
                  </div>
                ))
              )}
            </div>

            <Button onClick={handleSubmit} disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Indexer'
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Indexers Tab ─────────────────────────────────────────────────────────────

function IndexersTab() {
  const [indexers, setIndexers] = useState<ProwlarrIndexer[]>([]);
  const [statuses, setStatuses] = useState<ProwlarrIndexerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [indexersRes, statusRes] = await Promise.allSettled([
        fetch('/api/prowlarr/indexers'),
        fetch('/api/prowlarr/status'),
      ]);

      if (indexersRes.status === 'fulfilled' && indexersRes.value.ok) {
        const data = await indexersRes.value.json();
        if (Array.isArray(data)) setIndexers(data);
        else setError(data.error || 'Failed to load indexers');
      } else {
        setError('Failed to load indexers');
      }

      if (statusRes.status === 'fulfilled' && statusRes.value.ok) {
        const data = await statusRes.value.json();
        if (Array.isArray(data)) setStatuses(data);
      }
    } catch {
      setError('Failed to load indexers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleTest(id: number) {
    setTestingId(id);
    try {
      const res = await fetch(`/api/prowlarr/indexers/${id}/test`, { method: 'POST' });
      if (res.ok) {
        toast.success('Indexer test passed', { icon: <CheckCircle className="h-4 w-4 text-green-500" /> });
      } else {
        const data = await res.json();
        toast.error(data.error || 'Test failed', { icon: <XCircle className="h-4 w-4 text-red-500" /> });
      }
    } catch {
      toast.error('Test failed');
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/prowlarr/indexers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Indexer deleted');
        setIndexers((prev) => prev.filter((i) => i.id !== id));
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to delete');
      }
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeletingId(null);
      setConfirmDelete(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
        <p>{error}</p>
        <p className="text-sm mt-2">Make sure Prowlarr is configured in Settings.</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-muted-foreground">{indexers.length} indexer{indexers.length !== 1 ? 's' : ''}</p>
      </div>

      {indexers.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          No indexers configured.
        </div>
      ) : (
        <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
          {indexers.map((indexer) => (
            <div key={indexer.id} className="px-4 py-3 flex items-center gap-3">
              <IndexerStatusDot indexer={indexer} statuses={statuses} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{indexer.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${indexer.protocol === 'torrent' ? 'border-green-500/50 text-green-400' : 'border-blue-500/50 text-blue-400'}`}
                  >
                    {indexer.protocol}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    Priority: {indexer.priority}
                  </span>
                  {indexer.privacy && (
                    <span className="text-[11px] text-muted-foreground capitalize">{indexer.privacy}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => handleTest(indexer.id)}
                  disabled={testingId === indexer.id}
                >
                  {testingId === indexer.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    'Test'
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-destructive hover:text-destructive"
                  onClick={() => setConfirmDelete({ id: indexer.id, name: indexer.name })}
                  disabled={deletingId === indexer.id}
                >
                  {deletingId === indexer.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Indexer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{confirmDelete?.name}&rdquo;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => confirmDelete && handleDelete(confirmDelete.id)}
              disabled={!!deletingId}
            >
              {deletingId ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}

// ── Stats Tab ────────────────────────────────────────────────────────────────

type DateRange = '7d' | '30d' | '90d' | 'all';

function getStartDate(range: DateRange): string | undefined {
  if (range === 'all') return undefined;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const DATE_RANGES: { label: string; value: DateRange }[] = [
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: 'All', value: 'all' },
];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-background/95 backdrop-blur-sm px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold mb-1.5 text-foreground truncate max-w-[200px]">{label}</p>
      {payload.map((entry: { name: string; value: number; color: string }, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-foreground tabular-nums">
            {entry.name === 'Response' || entry.name === 'ms'
              ? formatMs(entry.value)
              : entry.name.includes('%')
                ? `${entry.value}%`
                : fmtNum(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function YTick({ x, y, payload }: any) {
  const text = String(payload?.value ?? '');
  const maxLen = 16;
  const display = text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="#888" fontSize={10}>
      {display}
    </text>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
}

function StatCard({ label, value, icon, iconBg }: StatCardProps) {
  return (
    <div className="rounded-xl bg-card border border-border p-3 sm:p-4 flex items-center gap-3">
      <div className={`rounded-lg p-2 shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest leading-none mb-1">{label}</p>
        <p className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      </div>
    </div>
  );
}

const BAR_H = 34;
const Y_WIDTH = 108;
const CHART_MARGIN = { top: 2, right: 12, left: 0, bottom: 2 };

function StatsTab() {
  const [stats, setStats] = useState<ProwlarrStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>('30d');

  const fetchStats = useCallback(async (range: DateRange) => {
    setLoading(true);
    setError(null);
    try {
      const startDate = getStartDate(range);
      const url = startDate
        ? `/api/prowlarr/stats?startDate=${encodeURIComponent(startDate)}`
        : '/api/prowlarr/stats';
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) setError(data.error);
      else setStats(data);
    } catch {
      setError('Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(dateRange); }, [fetchStats, dateRange]);

  if (error) {
    return (
      <div className="rounded-xl bg-card border border-border p-8 text-center text-muted-foreground">
        {error}
      </div>
    );
  }

  const indexers = stats?.indexers ?? [];
  const userAgents: ProwlarrUserAgentStat[] = stats?.userAgents ?? [];

  const totalQueries = indexers.reduce((a, i) => a + i.numberOfQueries + i.numberOfRssQueries + i.numberOfAuthQueries, 0);
  const totalGrabs = indexers.reduce((a, i) => a + i.numberOfGrabs, 0);
  const totalFailed = indexers.reduce((a, i) => a + i.numberOfFailedQueries + i.numberOfFailedRssQueries, 0);

  const responseData = [...indexers]
    .sort((a, b) => b.averageResponseTime - a.averageResponseTime)
    .map((i) => ({ name: i.indexerName, Response: Math.round(i.averageResponseTime) }));

  const failureData = indexers
    .filter((i) => i.numberOfFailedQueries > 0 || i.numberOfFailedRssQueries > 0)
    .map((i) => {
      const total = Math.max(i.numberOfQueries + i.numberOfRssQueries, 1);
      const failed = i.numberOfFailedQueries + i.numberOfFailedRssQueries;
      return { name: i.indexerName, 'Failure %': parseFloat(((failed / total) * 100).toFixed(1)) };
    })
    .sort((a, b) => b['Failure %'] - a['Failure %']);

  const queriesData = [...indexers]
    .sort((a, b) => (b.numberOfQueries + b.numberOfRssQueries) - (a.numberOfQueries + a.numberOfRssQueries))
    .map((i) => ({
      name: i.indexerName,
      Search: i.numberOfQueries,
      RSS: i.numberOfRssQueries,
      Auth: i.numberOfAuthQueries,
    }));

  const grabsData = indexers
    .filter((i) => i.numberOfGrabs > 0)
    .map((i) => ({ name: i.indexerName, Grabs: i.numberOfGrabs }))
    .sort((a, b) => b.Grabs - a.Grabs);

  const uaQueryData = userAgents
    .filter((u) => u.numberOfQueries > 0)
    .map((u) => ({ name: u.userAgent || 'Unknown', Queries: u.numberOfQueries }))
    .sort((a, b) => b.Queries - a.Queries)
    .slice(0, 10);

  const uaGrabData = userAgents
    .filter((u) => u.numberOfGrabs > 0)
    .map((u) => ({ name: u.userAgent || 'Unknown', Grabs: u.numberOfGrabs }))
    .sort((a, b) => b.Grabs - a.Grabs)
    .slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Date range pill selector */}
      <div className="flex bg-card border border-border rounded-lg p-1 gap-0.5 w-fit">
        {DATE_RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => setDateRange(r.value)}
            className={`px-4 py-1.5 rounded-md text-xs font-semibold transition-all ${dateRange === r.value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
              }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl bg-card border border-border p-4 h-[72px] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Summary stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Indexers"
              value={fmtNum(indexers.length)}
              icon={<Database className="h-4 w-4 text-sky-400" />}
              iconBg="bg-sky-500/10"
            />
            <StatCard
              label="Queries"
              value={fmtNum(totalQueries)}
              icon={<Search className="h-4 w-4 text-violet-400" />}
              iconBg="bg-violet-500/10"
            />
            <StatCard
              label="Grabs"
              value={fmtNum(totalGrabs)}
              icon={<Download className="h-4 w-4 text-emerald-400" />}
              iconBg="bg-emerald-500/10"
            />
            <StatCard
              label="Failed"
              value={fmtNum(totalFailed)}
              icon={<XCircle className="h-4 w-4 text-rose-400" />}
              iconBg="bg-rose-500/10"
            />
          </div>

          {/* Response Time */}
          {responseData.length > 0 && (
            <div className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Response Time</p>
              </div>
              <div className="px-2 pb-3">
                <ResponsiveContainer width="100%" height={Math.max(180, responseData.length * BAR_H)}>
                  <BarChart data={responseData} layout="vertical" margin={CHART_MARGIN} barSize={12}>
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#888' }}
                      tickFormatter={(v) => `${v}ms`}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={Y_WIDTH}
                      tick={<YTick />}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltipContent />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="Response" fill="#0ea5e9" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Failure Rate */}
          {failureData.length > 0 && (
            <div className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Failure Rate</p>
              </div>
              <div className="px-2 pb-3">
                <ResponsiveContainer width="100%" height={Math.max(120, failureData.length * BAR_H)}>
                  <BarChart data={failureData} layout="vertical" margin={CHART_MARGIN} barSize={12}>
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#888' }}
                      tickFormatter={(v) => `${v}%`}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={Y_WIDTH}
                      tick={<YTick />}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltipContent />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="Failure %" fill="#ef4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Queries by Indexer */}
          {queriesData.length > 0 && (
            <div className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="px-4 pt-4 pb-2 flex items-center gap-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Queries by Indexer</p>
                <div className="flex items-center gap-3 ml-auto">
                  {[
                    { color: '#6366f1', label: 'Search' },
                    { color: '#f59e0b', label: 'RSS' },
                    { color: '#ef4444', label: 'Auth' },
                  ].map(({ color, label }) => (
                    <span key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} />
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="px-2 pb-3">
                <ResponsiveContainer width="100%" height={Math.max(180, queriesData.length * BAR_H)}>
                  <BarChart data={queriesData} layout="vertical" margin={CHART_MARGIN} barSize={12}>
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#888' }}
                      tickFormatter={fmtNum}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={Y_WIDTH}
                      tick={<YTick />}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltipContent />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="Search" stackId="q" fill="#6366f1" />
                    <Bar dataKey="RSS" stackId="q" fill="#f59e0b" />
                    <Bar dataKey="Auth" stackId="q" fill="#ef4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Grabs by Indexer */}
          {grabsData.length > 0 && (
            <div className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Grabs by Indexer</p>
              </div>
              <div className="px-2 pb-3">
                <ResponsiveContainer width="100%" height={Math.max(120, grabsData.length * BAR_H)}>
                  <BarChart data={grabsData} layout="vertical" margin={CHART_MARGIN} barSize={12}>
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#888' }}
                      tickFormatter={fmtNum}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={Y_WIDTH}
                      tick={<YTick />}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltipContent />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="Grabs" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* User Agent — Queries */}
          {uaQueryData.length > 0 && (
            <div className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">User Agent — Queries</p>
              </div>
              <div className="px-2 pb-3">
                <ResponsiveContainer width="100%" height={Math.max(160, uaQueryData.length * BAR_H)}>
                  <BarChart data={uaQueryData} layout="vertical" margin={CHART_MARGIN} barSize={12}>
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#888' }}
                      tickFormatter={fmtNum}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={Y_WIDTH}
                      tick={<YTick />}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltipContent />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="Queries" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* User Agent — Grabs */}
          {uaGrabData.length > 0 && (
            <div className="rounded-xl bg-card border border-border overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">User Agent — Grabs</p>
              </div>
              <div className="px-2 pb-3">
                <ResponsiveContainer width="100%" height={Math.max(160, uaGrabData.length * BAR_H)}>
                  <BarChart data={uaGrabData} layout="vertical" margin={CHART_MARGIN} barSize={12}>
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: '#888' }}
                      tickFormatter={fmtNum}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={Y_WIDTH}
                      tick={<YTick />}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltipContent />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Bar dataKey="Grabs" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {indexers.length === 0 && (
            <div className="rounded-xl bg-card border border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">No stats for this period.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── History Tab ──────────────────────────────────────────────────────────────

// eventType values: 1=Grabbed, 2=IndexerQuery, 3=IndexerRss
// Failed uses successful=false instead of eventType
const HISTORY_FILTERS = [
  { label: 'All', value: '', eventType: undefined, successful: undefined },
  { label: 'Grabbed', value: '1', eventType: '1', successful: undefined },
  { label: 'Indexer Query', value: '2', eventType: '2', successful: undefined },
  { label: 'Indexer RSS', value: '3', eventType: '3', successful: undefined },
  { label: 'Failed', value: 'failed', eventType: undefined, successful: 'false' },
] as const;

type HistoryFilterValue = typeof HISTORY_FILTERS[number]['value'];

function EventIcon({ eventType }: { eventType: string }) {
  if (eventType === 'indexerRss') return <Rss className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  if (eventType === 'grab') return <Download className="h-3.5 w-3.5 text-green-400 shrink-0" />;
  if (eventType.toLowerCase().includes('fail')) return <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />;
  return <Search className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
}

function parseCategoryIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
}

function HistoryDrawer({
  record,
  onClose,
  indexerMap,
}: {
  record: ProwlarrHistoryRecord | null;
  onClose: () => void;
  indexerMap: Record<number, string>;
}) {
  const indexerName = record ? (indexerMap[record.indexerId] ?? record.indexer ?? `ID ${record.indexerId}`) : '';

  return (
    <Drawer open={!!record} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="text-sm break-all leading-snug">
            {indexerName || 'History Detail'}
          </DrawerTitle>
          <DrawerDescription>{record ? formatDate(record.date) : ''}</DrawerDescription>
        </DrawerHeader>
        {record && (
          <div className="px-4 pb-8 max-h-[70vh] overflow-y-auto space-y-3">
            {/* Event type + success badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] px-2 py-1 rounded-full bg-muted text-muted-foreground font-mono">
                {record.eventType}
              </span>
              {record.successful !== undefined && (
                <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${record.successful ? 'bg-green-500/10 text-green-400' : 'bg-rose-500/10 text-rose-400'
                  }`}>
                  {record.successful ? 'Successful' : 'Failed'}
                </span>
              )}
            </div>

            {/* Top-level fields */}
            <div className="rounded-lg bg-muted/30 overflow-hidden divide-y divide-border/40">
              {([
                ['Indexer', indexerName],
                ['Indexer ID', String(record.indexerId)],
                ['Date', formatDate(record.date)],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="flex gap-3 px-3 py-2">
                  <span className="text-[11px] text-muted-foreground w-28 shrink-0">{label}</span>
                  <span className="text-[11px] break-all">{value}</span>
                </div>
              ))}
            </div>

            {/* All data fields */}
            {Object.keys(record.data ?? {}).length > 0 && (
              <div className="rounded-lg bg-muted/30 overflow-hidden divide-y divide-border/40">
                {Object.entries(record.data).map(([key, value]) => {
                  if (value === '' || value === undefined) return null;
                  const isUrl = key === 'url' && String(value).startsWith('http');
                  return (
                    <div key={key} className="flex gap-3 px-3 py-2">
                      <span className="text-[11px] text-muted-foreground w-28 shrink-0 capitalize">{key}</span>
                      {isUrl ? (
                        <a
                          href={String(value)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-primary break-all hover:underline"
                        >
                          {String(value)}
                        </a>
                      ) : (
                        <span className="text-[11px] break-all">{String(value)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function HistoryTab() {
  const [records, setRecords] = useState<ProwlarrHistoryRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ProwlarrHistoryRecord | null>(null);
  const [activeFilter, setActiveFilter] = useState<HistoryFilterValue>('');
  const [indexerMap, setIndexerMap] = useState<Record<number, string>>({});

  const PAGE_SIZE = 20;

  // Fetch indexers once to build id→name map
  useEffect(() => {
    fetch('/api/prowlarr/indexers')
      .then((r) => r.json())
      .then((data: ProwlarrIndexer[]) => {
        if (Array.isArray(data)) {
          const map: Record<number, string> = {};
          for (const idx of data) map[idx.id] = idx.name;
          setIndexerMap(map);
        }
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  function buildUrl(p: number, filterValue: HistoryFilterValue) {
    const f = HISTORY_FILTERS.find((x) => x.value === filterValue)!;
    const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
    if (f.eventType) params.set('eventType', f.eventType);
    if (f.successful !== undefined) params.set('successful', f.successful);
    return `/api/prowlarr/history?${params}`;
  }

  useEffect(() => {
    setLoading(true);
    setRecords([]);
    fetch(buildUrl(1, activeFilter))
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setRecords(data.records ?? []);
          setTotalRecords(data.totalRecords ?? 0);
          setPage(1);
        }
      })
      .catch(() => setError('Failed to load history'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter]);

  async function loadMore() {
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const res = await fetch(buildUrl(nextPage, activeFilter));
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        setRecords((prev) => [...prev, ...(data.records ?? [])]);
        setPage(nextPage);
      }
    } catch {
      toast.error('Failed to load more history');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {HISTORY_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setActiveFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${activeFilter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-card border border-border text-muted-foreground hover:text-foreground'
              }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-card border border-border p-8 text-center text-muted-foreground">
          {error}
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-xl bg-card border border-border p-8 text-center text-muted-foreground">
          No records for this filter.
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {records.length} of {totalRecords} records
          </p>
          <div className="rounded-xl bg-card border border-border overflow-hidden divide-y divide-border/50">
            {records.map((record) => {
              const d = record.data ?? {};
              const query = d.query || record.query || '';
              const queryType = d.queryType;
              const source = d.source;
              const elapsed = d.elapsedTime;
              const categoryIds = parseCategoryIds(d.categories);
              const uniqueCategories = [...new Set(categoryIds.map((id) => categoryLabel(id)))];

              return (
                <button
                  key={record.id}
                  onClick={() => setSelectedRecord(record)}
                  className="w-full px-4 py-3 flex items-start gap-2.5 text-left hover:bg-accent/50 transition-colors"
                >
                  <div className="mt-0.5 shrink-0">
                    <EventIcon eventType={record.eventType} />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* Query + queryType badge */}
                    <div className="flex items-center gap-1.5">
                      {query ? <span className="text-sm font-medium truncate">{query}</span> : null}
                      {queryType && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono shrink-0">
                          {queryType}
                        </span>
                      )}
                    </div>
                    {/* Category chips */}
                    {uniqueCategories.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        {uniqueCategories.slice(0, 3).map((cat) => (
                          <span
                            key={cat}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${categoryColor(categoryIds.find((id) => categoryLabel(id) === cat) ?? 0)}`}
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* Source · Indexer · elapsed · time */}
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground flex-wrap">
                      {[source, indexerMap[record.indexerId] ?? record.indexer ?? null, elapsed ? `${elapsed}ms` : null, formatTime(record.date)]
                        .filter(Boolean)
                        .map((item, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && <span className="opacity-30">·</span>}
                            <span className="truncate max-w-[110px]">{item}</span>
                          </span>
                        ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {records.length < totalRecords && (
            <Button
              variant="outline"
              className="w-full"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                `Load More (${totalRecords - records.length} remaining)`
              )}
            </Button>
          )}
        </>
      )}

      <HistoryDrawer record={selectedRecord} onClose={() => setSelectedRecord(null)} indexerMap={indexerMap} />
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ProwlarrPage() {
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testingAll, setTestingAll] = useState(false);

  async function sendCommand(name: string, label: string, setter: (v: boolean) => void) {
    setter(true);
    try {
      const res = await fetch('/api/prowlarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        toast.success(`${label} command sent`);
      } else {
        const data = await res.json();
        toast.error(data.error || `${label} failed`);
      }
    } catch {
      toast.error(`${label} failed`);
    } finally {
      setter(false);
    }
  }

  async function handleTestAll() {
    setTestingAll(true);
    try {
      const res = await fetch('/api/prowlarr/indexers/testall', { method: 'POST' });
      if (res.ok) {
        toast.success('Test All complete');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Test All failed');
      }
    } catch {
      toast.error('Test All failed');
    } finally {
      setTestingAll(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => sendCommand('RefreshIndexer', 'Refresh All', setRefreshing)}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh All
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => sendCommand('ApplicationIndexerSync', 'Sync All', setSyncing)}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Sync All
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          onClick={handleTestAll}
          disabled={testingAll}
        >
          {testingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4" />
          )}
          Test All
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="indexers">
        <TabsList className="w-full">
          <TabsTrigger value="indexers" className="flex-1">Indexers</TabsTrigger>
          <TabsTrigger value="stats" className="flex-1">Stats</TabsTrigger>
          <TabsTrigger value="history" className="flex-1">History</TabsTrigger>
        </TabsList>

        <TabsContent value="indexers" className="mt-4">
          <IndexersTab />
        </TabsContent>

        <TabsContent value="stats" className="mt-4">
          <StatsTab />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
