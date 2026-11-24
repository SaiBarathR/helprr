'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Loader2 } from 'lucide-react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** As qBittorrent stores them: -2 uses the global limit, -1 is unlimited, times are minutes. */
export interface ShareLimitValues {
  ratio_limit: number;
  seeding_time_limit: number;
  inactive_seeding_time_limit: number;
}
export type ShareLimitField = keyof ShareLimitValues;

const USE_GLOBAL = -2;
const UNLIMITED = -1;
// Kept in step with parseShareLimits (src/lib/qbittorrent-inputs.ts).
const MAX_RATIO = 9998;
const MAX_MINUTES = 525_600;

const FIELDS: { field: ShareLimitField; label: string; kind: 'ratio' | 'time' }[] = [
  { field: 'ratio_limit', label: 'Ratio Limit', kind: 'ratio' },
  { field: 'seeding_time_limit', label: 'Seeding Time Limit', kind: 'time' },
  { field: 'inactive_seeding_time_limit', label: 'Inactive Seeding Limit', kind: 'time' },
];

type Mode = 'global' | 'unlimited' | 'custom';
type Unit = 'minutes' | 'hours' | 'days';
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

interface Draft {
  /** Empty while the torrents being edited disagree and nothing is chosen yet. */
  mode: Mode | '';
  value: string;
  unit: Unit;
}

function formatRatio(ratio: number): string {
  return ratio.toFixed(2).replace(/\.?0+$/, '');
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return [days && `${days} d`, hours && `${hours} h`, rest && `${rest} min`].filter(Boolean).join(' ');
}

function formatLimit(kind: 'ratio' | 'time', value: number): string {
  if (value < 0) return 'Unlimited';
  return kind === 'ratio' ? formatRatio(value) : formatMinutes(value);
}

/** How a torrent's own limit reads; `effective` is qBittorrent's max_* while it uses the global one. */
export function formatShareLimit(kind: 'ratio' | 'time', value: number | null, effective?: number): string {
  if (value === null) return 'Mixed';
  if (value === USE_GLOBAL) return effective === undefined ? 'Global' : `Global (${formatLimit(kind, effective)})`;
  return formatLimit(kind, value);
}

function draftFor(kind: 'ratio' | 'time', value: number | null): Draft {
  if (value === null) return { mode: '', value: '', unit: 'hours' };
  if (value === USE_GLOBAL) return { mode: 'global', value: '', unit: 'hours' };
  if (value < 0) return { mode: 'unlimited', value: '', unit: 'hours' };
  if (kind === 'ratio') return { mode: 'custom', value: formatRatio(value), unit: 'hours' };
  const unit: Unit = value > 0 && value % 1440 === 0 ? 'days' : value > 0 && value % 60 === 0 ? 'hours' : 'minutes';
  return { mode: 'custom', value: String(value / UNIT_MINUTES[unit]), unit };
}

/** The value to send, or an error to show. */
function parseDraft(kind: 'ratio' | 'time', label: string, draft: Draft): number | string {
  if (draft.mode === '') return `Choose a setting for ${label.toLowerCase()}`;
  if (draft.mode === 'global') return USE_GLOBAL;
  if (draft.mode === 'unlimited') return UNLIMITED;
  const number = Number(draft.value);
  if (draft.value.trim() === '' || !Number.isFinite(number) || number < 0) return `Enter a number for ${label.toLowerCase()}`;
  if (kind === 'ratio') {
    return number <= MAX_RATIO ? Math.round(number * 100) / 100 : `The ratio limit can be at most ${MAX_RATIO}`;
  }
  const minutes = Math.round(number * UNIT_MINUTES[draft.unit]);
  return minutes <= MAX_MINUTES ? minutes : `${label} can be at most a year`;
}

/**
 * A torrent's ratio, seeding time and inactive seeding time limits. qBittorrent
 * sets the three together, so one editor holds all of them. Without
 * `allowGlobal` it edits the global limits themselves (Torrents settings), which
 * are a limit or none.
 */
export function ShareLimitsSection({
  values,
  effective,
  target,
  readOnly = false,
  allowGlobal = true,
  title = 'Share Limits',
  footer = 'What qBittorrent does when a torrent reaches a limit (stop it or remove it) is set with the global limits, in qBittorrent Settings.',
  onSave,
}: {
  /** null where the torrents being edited disagree. */
  values: Record<ShareLimitField, number | null>;
  /** The limit in force while a torrent uses the global one (qBittorrent's max_*), when known. */
  effective?: Partial<Record<ShareLimitField, number>>;
  /** Who the limits apply to, named in the toast (e.g. "3 torrents"). */
  target?: string;
  readOnly?: boolean;
  /** Offer "Use global limit" (a torrent's own limits); false for the global limits. */
  allowGlobal?: boolean;
  title?: string;
  footer?: string;
  /** Resolves false once the failure has been toasted (useTorrentAction). */
  onSave?: (values: ShareLimitValues) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<Record<ShareLimitField, Draft> | null>(null);
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    setDrafts(Object.fromEntries(FIELDS.map(({ field, kind }) => [field, draftFor(kind, values[field])])) as Record<ShareLimitField, Draft>);
  };

  const setDraft = (field: ShareLimitField, change: Partial<Draft>) =>
    setDrafts((prev) => (prev ? { ...prev, [field]: { ...prev[field], ...change } } : prev));

  const handleSave = async (event: FormEvent) => {
    // A form, so the keyboard's return key saves too.
    event.preventDefault();
    if (!drafts || !onSave) return;
    const next = {} as ShareLimitValues;
    for (const { field, kind, label } of FIELDS) {
      const parsed = parseDraft(kind, label, drafts[field]);
      if (typeof parsed === 'string') {
        toast.error(parsed);
        return;
      }
      next[field] = parsed;
    }
    setSaving(true);
    try {
      if (await onSave(next)) {
        setDrafts(null);
        // Sentence case: "Share limits updated".
        toast.success(`${title.charAt(0)}${title.slice(1).toLowerCase()} updated${target ? ` for ${target}` : ''}`);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!drafts) {
    return (
      <GroupedSection title={title} footer={footer}>
        {FIELDS.map(({ field, label, kind }) => {
          const text = formatShareLimit(kind, values[field], effective?.[field]);
          return readOnly ? (
            <div key={field} className="grouped-row">
              <span className="text-sm">{label}</span>
              <span className="text-sm text-muted-foreground text-right min-w-0 ml-4">{text}</span>
            </div>
          ) : (
            <button
              key={field}
              type="button"
              className="grouped-row w-full text-left hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
              onClick={startEditing}
            >
              <span className="text-sm">{label}</span>
              <span className="flex items-center gap-1 text-sm text-muted-foreground text-right min-w-0 ml-4">
                {text}
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              </span>
            </button>
          );
        })}
      </GroupedSection>
    );
  }

  return (
    <GroupedSection title={title} footer={footer}>
      <form className="grouped-row grouped-row-stacked gap-4" onSubmit={handleSave}>
        {FIELDS.map(({ field, label, kind }) => {
          const draft = drafts[field];
          return (
            <div key={field} className="flex flex-col gap-2">
              <span className="text-sm">{label}</span>
              <Select value={draft.mode} onValueChange={(mode) => setDraft(field, { mode: mode as Mode })}>
                <SelectTrigger aria-label={`${label} setting`} className="w-full">
                  <SelectValue placeholder="Mixed: choose one" />
                </SelectTrigger>
                <SelectContent>
                  {allowGlobal && <SelectItem value="global">Use global limit</SelectItem>}
                  <SelectItem value="unlimited">Unlimited</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              {draft.mode === 'custom' && (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step={kind === 'ratio' ? '0.01' : '1'}
                    value={draft.value}
                    onChange={(e) => setDraft(field, { value: e.target.value })}
                    placeholder={kind === 'ratio' ? '2.0' : '0'}
                    aria-label={label}
                    className="flex-1"
                  />
                  {kind === 'time' && (
                    <Select value={draft.unit} onValueChange={(unit) => setDraft(field, { unit: unit as Unit })}>
                      <SelectTrigger aria-label={`${label} unit`} className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="minutes">Minutes</SelectItem>
                        <SelectItem value="hours">Hours</SelectItem>
                        <SelectItem value="days">Days</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className="flex gap-2">
          <Button type="submit" size="sm" className="flex-1" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setDrafts(null)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>
    </GroupedSection>
  );
}
