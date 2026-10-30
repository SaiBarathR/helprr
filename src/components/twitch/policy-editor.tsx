'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { BUILT_IN_POLICY, type PolicyLayer, type TwitchPolicy, type VideoTypeKey } from '@/lib/twitch/policy';
import { cn } from '@/lib/utils';

const SWITCHES = [
  ['autoDownload', 'Download automatically'],
  ['chat', 'Archive chat'],
  ['chapters', 'Chapters from games'],
  ['reencode', 'Re-encode at night'],
  ['keepForever', 'Keep forever'],
] as const;

const QUALITIES = ['1440p60', '1080p60', '720p60', '480p', 'audio_only'];

const splitWords = (text: string) => text.split(',').map((word) => word.trim()).filter(Boolean);

/** Each field either inherits, shown greyed out, or is overridden in this layer. */
export function PolicyEditor({ value, inherited = BUILT_IN_POLICY, onChange }: {
  value: PolicyLayer;
  inherited?: Partial<TwitchPolicy>;
  onChange: (next: PolicyLayer) => void;
}) {
  const setField = <K extends keyof TwitchPolicy>(field: K, next: TwitchPolicy[K] | undefined) => {
    const copy = { ...value };
    if (next === undefined) delete copy[field];
    else copy[field] = next;
    onChange(copy);
  };
  const conditions = value.conditions ?? {};
  const setCondition = (patch: Partial<TwitchPolicy['conditions']>) => setField('conditions', { ...conditions, ...patch });

  return (
    <div className="space-y-3">
      <div className="grouped-section-content">
        {SWITCHES.map(([field, label]) => {
          const overridden = value[field] !== undefined;
          const current = (overridden ? value[field] : inherited[field] ?? BUILT_IN_POLICY[field]) as boolean;
          return (
            <div key={field} className="grouped-row min-h-11">
              <span className="text-sm">{label}</span>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  className="min-h-9 px-1 text-xs text-primary disabled:text-muted-foreground"
                  disabled={!overridden}
                  onClick={() => setField(field, undefined)}
                >
                  {overridden ? 'Reset' : 'Inherited'}
                </button>
                <Switch
                  aria-label={label}
                  className={overridden ? undefined : 'opacity-50'}
                  checked={current}
                  onCheckedChange={(checked) => setField(field, checked)}
                />
              </span>
            </div>
          );
        })}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Quality</Label>
        <select
          aria-label="Quality"
          value={value.quality ?? ''}
          onChange={(event) => setField('quality', event.target.value || undefined)}
          className="h-10 w-full rounded-md border border-border bg-card px-2 text-sm"
        >
          <option value="">Inherited ({inherited.quality ?? BUILT_IN_POLICY.quality})</option>
          {QUALITIES.map((quality) => <option key={quality} value={quality}>{quality}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Min length (minutes)" value={conditions.minDurationMinutes} onChange={(minDurationMinutes) => setCondition({ minDurationMinutes })} />
        <NumberField label="Max length (minutes)" value={conditions.maxDurationMinutes} onChange={(maxDurationMinutes) => setCondition({ maxDurationMinutes })} />
        <WordsField label="Category is one of" value={conditions.categoryInclude} onChange={(categoryInclude) => setCondition({ categoryInclude })} />
        <WordsField label="Category is not" value={conditions.categoryExclude} onChange={(categoryExclude) => setCondition({ categoryExclude })} />
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Title has any of</Label>
          <Input
            placeholder="comma separated"
            defaultValue={conditions.titleInclude?.join(', ')}
            onBlur={(event) => setCondition({ titleInclude: splitWords(event.target.value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Title has none of</Label>
          <Input
            placeholder="comma separated"
            defaultValue={conditions.titleExclude?.join(', ')}
            onBlur={(event) => setCondition({ titleExclude: splitWords(event.target.value) })}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Keep the latest" placeholder={String(inherited.keepLatest ?? 'No limit')} value={value.keepLatest ?? undefined} onChange={(keepLatest) => setField('keepLatest', keepLatest)} />
        <NumberField label="Delete after days" placeholder={String(inherited.deleteAfterDays ?? 'Never')} value={value.deleteAfterDays ?? undefined} onChange={(deleteAfterDays) => setField('deleteAfterDays', deleteAfterDays)} />
        <NumberField label="Delete days after watched" placeholder={String(inherited.deleteAfterWatchedDays ?? 'Never')} value={value.deleteAfterWatchedDays ?? undefined} onChange={(deleteAfterWatchedDays) => setField('deleteAfterWatchedDays', deleteAfterWatchedDays)} />
      </div>
    </div>
  );
}

// Empty means inherit, so a stored 0 stays distinct from no value.
function NumberField({ label, value, placeholder, onChange }: {
  label: string;
  value: number | undefined;
  placeholder?: string;
  onChange: (next: number | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          className="mt-1.5"
          placeholder={placeholder}
          defaultValue={value}
          onBlur={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        />
      </Label>
    </div>
  );
}

function WordsField({ label, value, onChange }: { label: string; value: string[] | undefined; onChange: (next: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        <Input className="mt-1.5" placeholder="comma separated" defaultValue={value?.join(', ')} onBlur={(event) => onChange(splitWords(event.target.value))} />
      </Label>
    </div>
  );
}

const LAYER_TABS = [
  { id: 'base', label: 'All' },
  { id: 'ARCHIVE', label: 'Broadcasts' },
  { id: 'HIGHLIGHT', label: 'Highlights' },
  { id: 'UPLOAD', label: 'Uploads' },
] as const;

export interface RuleLayerValue {
  base: PolicyLayer;
  types: Partial<Record<VideoTypeKey, PolicyLayer>>;
}

/** A layer, and the per-video-type layers that override it. */
export function RuleLayers({ value, inherited, onChange }: {
  value: RuleLayerValue;
  inherited?: Partial<TwitchPolicy>;
  onChange: (next: RuleLayerValue) => void;
}) {
  const [tab, setTab] = useState<(typeof LAYER_TABS)[number]['id']>('base');
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Video type" className="grid grid-cols-4 gap-1 rounded-md bg-muted/40 p-1">
        {LAYER_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn('min-h-9 rounded text-xs font-medium', tab === item.id ? 'bg-background shadow-sm' : 'text-muted-foreground')}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'base' ? (
        <PolicyEditor key="base" value={value.base} inherited={inherited} onChange={(base) => onChange({ ...value, base })} />
      ) : (
        <PolicyEditor
          key={tab}
          value={value.types[tab] ?? {}}
          inherited={{ ...inherited, ...value.base }}
          onChange={(layer) => onChange({ ...value, types: { ...value.types, [tab]: layer } })}
        />
      )}
    </div>
  );
}
