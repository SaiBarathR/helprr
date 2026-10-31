'use client';

import { useState } from 'react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BUILT_IN_POLICY, type PolicyLayer, type TwitchPolicy, type VideoTypeKey } from '@/lib/twitch/policy';
import { NumberRow, SwitchRow, TextRow } from './setting-rows';

const DOWNLOAD_SWITCHES = [
  ['autoDownload', 'Download automatically'],
  ['chat', 'Archive chat'],
  ['chapters', 'Chapters from games'],
  ['reencode', 'Re-encode at night'],
] as const;
const KEEP_SWITCHES = [['keepForever', 'Keep forever']] as const;

const QUALITIES: Record<string, string> = {
  '1440p60': '1440p',
  '1080p60': '1080p60',
  '720p60': '720p60',
  '480p': '480p',
  audio_only: 'Audio only',
};
const INHERIT = 'inherit';

const splitWords = (text: string) => text.split(',').map((word) => word.trim()).filter(Boolean);

/** A field left alone inherits, shown dimmed. Changing one overrides it in this layer. */
export function PolicyEditor({ value, inherited = BUILT_IN_POLICY, footer, onChange }: {
  value: PolicyLayer;
  inherited?: Partial<TwitchPolicy>;
  footer: string;
  onChange: (next: PolicyLayer) => void;
}) {
  const setField = <K extends keyof TwitchPolicy>(field: K, next: TwitchPolicy[K] | undefined) => {
    const copy = { ...value };
    if (next === undefined) delete copy[field];
    else copy[field] = next;
    onChange(copy);
  };
  const conditions = value.conditions ?? {};
  // A layer's conditions replace the ones below as a whole, so those show as a hint.
  const inheritedConditions = inherited.conditions ?? {};
  const setCondition = (patch: Partial<TwitchPolicy['conditions']>) => setField('conditions', { ...conditions, ...patch });

  const switchRow = ([field, label]: readonly [keyof TwitchPolicy & ('autoDownload' | 'notify' | 'chat' | 'chapters' | 'reencode' | 'keepForever'), string]) => {
    const overridden = value[field] !== undefined;
    return (
      <SwitchRow
        key={field}
        label={label}
        dimmed={!overridden}
        checked={(overridden ? value[field] : inherited[field] ?? BUILT_IN_POLICY[field]) as boolean}
        onCheckedChange={(checked) => setField(field, checked)}
      >
        {overridden && (
          <button type="button" className="min-h-9 px-1 text-xs text-primary" onClick={() => setField(field, undefined)}>Reset</button>
        )}
      </SwitchRow>
    );
  };
  const inheritedQuality = inherited.quality ?? BUILT_IN_POLICY.quality;

  return (
    <>
      <GroupedSection title="Downloads" footer={footer}>
        {DOWNLOAD_SWITCHES.slice(0, 1).map(switchRow)}
        <div className="grouped-row gap-3">
          <Label className="shrink-0 text-sm font-normal">Quality</Label>
          <Select
            value={value.quality ?? INHERIT}
            onValueChange={(next) => setField('quality', next === INHERIT ? undefined : next)}
          >
            <SelectTrigger aria-label="Quality" className="h-auto w-auto gap-1 border-0 bg-transparent px-2 py-1 text-sm text-muted-foreground shadow-none focus:ring-0 dark:bg-transparent [&>svg]:h-3.5 [&>svg]:w-3.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={INHERIT}>Inherited ({QUALITIES[inheritedQuality] ?? inheritedQuality})</SelectItem>
              {Object.entries(QUALITIES).map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {DOWNLOAD_SWITCHES.slice(1).map(switchRow)}
        {switchRow(['notify', 'Notify about new videos'])}
      </GroupedSection>

      <GroupedSection title="Only when" footer="Separate words with commas">
        <NumberRow
          label="Longer than"
          unit="min"
          min={0}
          placeholder={inheritedConditions.minDurationMinutes?.toString() ?? 'Any'}
          value={conditions.minDurationMinutes ?? ''}
          onChange={(event) => setCondition({ minDurationMinutes: toNumber(event.target.value) })}
        />
        <NumberRow
          label="Shorter than"
          unit="min"
          min={0}
          placeholder={inheritedConditions.maxDurationMinutes?.toString() ?? 'Any'}
          value={conditions.maxDurationMinutes ?? ''}
          onChange={(event) => setCondition({ maxDurationMinutes: toNumber(event.target.value) })}
        />
        <WordsRow label="Category is one of" inherited={inheritedConditions.categoryInclude} value={conditions.categoryInclude} onChange={(categoryInclude) => setCondition({ categoryInclude })} />
        <WordsRow label="Category is not" inherited={inheritedConditions.categoryExclude} value={conditions.categoryExclude} onChange={(categoryExclude) => setCondition({ categoryExclude })} />
        <WordsRow label="Title has any of" inherited={inheritedConditions.titleInclude} value={conditions.titleInclude} onChange={(titleInclude) => setCondition({ titleInclude })} />
        <WordsRow label="Title has none of" inherited={inheritedConditions.titleExclude} value={conditions.titleExclude} onChange={(titleExclude) => setCondition({ titleExclude })} />
      </GroupedSection>

      <GroupedSection title="Clean up">
        {KEEP_SWITCHES.map(switchRow)}
        <NumberRow
          label="Keep the latest"
          unit="videos"
          min={0}
          placeholder={String(inherited.keepLatest ?? 'All')}
          value={value.keepLatest ?? ''}
          onChange={(event) => setField('keepLatest', toNumber(event.target.value))}
        />
        <NumberRow
          label="Delete after"
          unit="days"
          min={0}
          placeholder={String(inherited.deleteAfterDays ?? 'Never')}
          value={value.deleteAfterDays ?? ''}
          onChange={(event) => setField('deleteAfterDays', toNumber(event.target.value))}
        />
        <NumberRow
          label="Delete once watched, after"
          unit="days"
          min={0}
          placeholder={String(inherited.deleteAfterWatchedDays ?? 'Never')}
          value={value.deleteAfterWatchedDays ?? ''}
          onChange={(event) => setField('deleteAfterWatchedDays', toNumber(event.target.value))}
        />
      </GroupedSection>
    </>
  );
}

// Empty means inherit, so a stored 0 stays distinct from no value.
function toNumber(text: string): number | undefined {
  return text === '' ? undefined : Number(text);
}

function WordsRow({ label, value, inherited, onChange }: {
  label: string;
  value: string[] | undefined;
  inherited?: string[];
  onChange: (next: string[]) => void;
}) {
  // Kept as typed: splitting on every key would swallow the comma just entered.
  const [text, setText] = useState(value?.join(', ') ?? '');
  return (
    <TextRow
      label={label}
      placeholder={inherited?.join(', ') || 'Any'}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(splitWords(event.target.value));
      }}
    />
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
export function RuleLayers({ value, inherited, inheritedTypes, footer, onChange }: {
  value: RuleLayerValue;
  inherited?: Partial<TwitchPolicy>;
  /** The global per-type rules, which a streamer's layers sit on top of. */
  inheritedTypes?: RuleLayerValue['types'];
  footer: string;
  onChange: (next: RuleLayerValue) => void;
}) {
  const [tab, setTab] = useState<(typeof LAYER_TABS)[number]['id']>('base');
  return (
    <>
      <Tabs value={tab} onValueChange={(next) => setTab(next as typeof tab)} className="mb-4">
        <TabsList className="w-full">
          {LAYER_TABS.map((item) => <TabsTrigger key={item.id} value={item.id} className="flex-1">{item.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {tab === 'base' ? (
        <PolicyEditor key="base" value={value.base} inherited={inherited} footer={footer} onChange={(base) => onChange({ ...value, base })} />
      ) : (
        <PolicyEditor
          key={tab}
          value={value.types[tab] ?? {}}
          inherited={{ ...inherited, ...inheritedTypes?.[tab], ...value.base }}
          footer={footer}
          onChange={(layer) => onChange({ ...value, types: { ...value.types, [tab]: layer } })}
        />
      )}
    </>
  );
}
