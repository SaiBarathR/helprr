'use client';

import { useState } from 'react';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BUILT_IN_POLICY, type PolicyLayer, type TwitchPolicy, type VideoTypeKey } from '@/lib/archive/policy';
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

type Variant = 'twitch' | 'youtube';

const YOUTUBE_SWITCHES = [
  ['autoDownload', 'Download automatically'],
  ['captions', 'Save captions'],
  ['chapters', 'Keep chapters'],
  ['reencode', 'Re-encode to H.265 at night'],
] as const;
const YOUTUBE_QUALITIES: Record<string, string> = {
  best: 'Best',
  2160: '4K',
  1440: '1440p',
  1080: '1080p',
  720: '720p',
  480: '480p',
};
const CODECS: Record<string, string> = { compatible: 'Most compatible', av1: 'AV1', vp9: 'VP9', best: 'Best available' };
const SPONSORBLOCK: Record<string, string> = { mark: 'Mark as chapters', remove: 'Remove sponsors', off: 'Off' };

const splitWords = (text: string) => text.split(',').map((word) => word.trim()).filter(Boolean);

/** A field left alone inherits, shown dimmed. Changing one overrides it in this layer. */
export function PolicyEditor({ value, inherited, footer, onChange, variant = 'twitch', builtIn = BUILT_IN_POLICY }: {
  value: PolicyLayer;
  inherited?: Partial<TwitchPolicy>;
  footer: string;
  onChange: (next: PolicyLayer) => void;
  variant?: Variant;
  builtIn?: TwitchPolicy;
}) {
  const isYoutube = variant === 'youtube';
  const baseline = inherited ?? builtIn;
  const qualities = isYoutube ? YOUTUBE_QUALITIES : QUALITIES;
  const switches = isYoutube ? YOUTUBE_SWITCHES : DOWNLOAD_SWITCHES;
  const setField = <K extends keyof TwitchPolicy>(field: K, next: TwitchPolicy[K] | undefined) => {
    const copy = { ...value };
    if (next === undefined) delete copy[field];
    else copy[field] = next;
    onChange(copy);
  };
  const conditions = value.conditions ?? {};
  // A layer's conditions replace the ones below as a whole, so those show as a hint.
  const inheritedConditions = baseline.conditions ?? {};
  const setCondition = (patch: Partial<TwitchPolicy['conditions']>) => setField('conditions', { ...conditions, ...patch });

  const switchRow = ([field, label]: readonly [keyof TwitchPolicy & ('autoDownload' | 'notify' | 'chat' | 'chapters' | 'reencode' | 'keepForever' | 'captions'), string]) => {
    const overridden = value[field] !== undefined;
    return (
      <SwitchRow
        key={field}
        label={label}
        dimmed={!overridden}
        checked={(overridden ? value[field] : baseline[field] ?? builtIn[field]) as boolean}
        onCheckedChange={(checked) => setField(field, checked)}
      >
        {overridden && (
          <button type="button" className="min-h-9 px-1 text-xs text-primary" onClick={() => setField(field, undefined)}>Reset</button>
        )}
      </SwitchRow>
    );
  };
  const choiceRow = (field: 'quality' | 'codec' | 'sponsorblock', label: string, options: Record<string, string>) => {
    const fallback = String(baseline[field] ?? builtIn[field]);
    return (
      <div className="grouped-row gap-3">
        <Label className="shrink-0 text-sm font-normal">{label}</Label>
        <Select value={value[field] ?? INHERIT} onValueChange={(next) => setField(field, next === INHERIT ? undefined : next)}>
          {/* min-w-0 and a block value: a long value ("Inherited (Mark as chapters)" at 320 px) ends in "…" inside the card. */}
          <SelectTrigger aria-label={label} className="h-auto w-auto min-w-0 gap-1 border-0 bg-transparent px-2 py-1 text-sm text-muted-foreground shadow-none focus:ring-0 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT}>Inherited ({options[fallback] ?? fallback})</SelectItem>
            {Object.entries(options).map(([id, text]) => <SelectItem key={id} value={id}>{text}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <>
      <GroupedSection title="Downloads" footer={isYoutube ? `${footer}. Most compatible uses H.264 up to 1080p, and VP9 above that.` : footer}>
        {switches.slice(0, 1).map(switchRow)}
        {choiceRow('quality', 'Quality', qualities)}
        {isYoutube && choiceRow('codec', 'Codec', CODECS)}
        {isYoutube && choiceRow('sponsorblock', 'SponsorBlock', SPONSORBLOCK)}
        {isYoutube && (
          <NumberRow
            label="Wait before downloading"
            unit="min"
            min={0}
            placeholder={String(baseline.delayMinutes ?? builtIn.delayMinutes ?? 0)}
            value={value.delayMinutes ?? ''}
            onChange={(event) => setField('delayMinutes', toNumber(event.target.value))}
          />
        )}
        {switches.slice(1).map(switchRow)}
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
        {!isYoutube && <WordsRow label="Category is one of" inherited={inheritedConditions.categoryInclude} value={conditions.categoryInclude} onChange={(categoryInclude) => setCondition({ categoryInclude })} />}
        {!isYoutube && <WordsRow label="Category is not" inherited={inheritedConditions.categoryExclude} value={conditions.categoryExclude} onChange={(categoryExclude) => setCondition({ categoryExclude })} />}
        <WordsRow label="Title has any of" inherited={inheritedConditions.titleInclude} value={conditions.titleInclude} onChange={(titleInclude) => setCondition({ titleInclude })} />
        <WordsRow label="Title has none of" inherited={inheritedConditions.titleExclude} value={conditions.titleExclude} onChange={(titleExclude) => setCondition({ titleExclude })} />
      </GroupedSection>

      <GroupedSection title="Clean up">
        {KEEP_SWITCHES.map(switchRow)}
        <NumberRow
          label="Keep the latest"
          unit="videos"
          min={0}
          placeholder={String(baseline.keepLatest ?? builtIn.keepLatest ?? 'All')}
          value={value.keepLatest ?? ''}
          onChange={(event) => setField('keepLatest', toNumber(event.target.value))}
        />
        <NumberRow
          label="Delete after"
          unit="days"
          min={0}
          placeholder={String(baseline.deleteAfterDays ?? builtIn.deleteAfterDays ?? 'Never')}
          value={value.deleteAfterDays ?? ''}
          onChange={(event) => setField('deleteAfterDays', toNumber(event.target.value))}
        />
        <NumberRow
          label="Delete once watched, after"
          unit="days"
          min={0}
          placeholder={String(baseline.deleteAfterWatchedDays ?? builtIn.deleteAfterWatchedDays ?? 'Never')}
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

const TWITCH_TABS = [
  { id: 'base', label: 'All' },
  { id: 'ARCHIVE', label: 'Broadcasts' },
  { id: 'HIGHLIGHT', label: 'Highlights' },
  { id: 'UPLOAD', label: 'Uploads' },
] as const;
const YOUTUBE_TABS = [
  { id: 'base', label: 'All' },
  { id: 'UPLOAD', label: 'Videos' },
  { id: 'ARCHIVE', label: 'Live' },
  { id: 'SHORT', label: 'Shorts' },
] as const;

export interface RuleLayerValue {
  base: PolicyLayer;
  types: Partial<Record<VideoTypeKey, PolicyLayer>>;
}

/** A layer, and the per-video-type layers that override it. */
export function RuleLayers({ value, inherited, inheritedTypes, footer, onChange, variant = 'twitch', builtIn }: {
  value: RuleLayerValue;
  inherited?: Partial<TwitchPolicy>;
  /** The global per-type rules, which a creator's layers sit on top of. */
  inheritedTypes?: RuleLayerValue['types'];
  footer: string;
  onChange: (next: RuleLayerValue) => void;
  variant?: Variant;
  builtIn?: TwitchPolicy;
}) {
  const [tab, setTab] = useState<'base' | VideoTypeKey>('base');
  const tabs = variant === 'youtube' ? YOUTUBE_TABS : TWITCH_TABS;
  const shared = { footer, variant, builtIn };
  return (
    <>
      <Tabs value={tab} onValueChange={(next) => setTab(next as typeof tab)} className="mb-4">
        <TabsList className="w-full">
          {tabs.map((item) => <TabsTrigger key={item.id} value={item.id} className="flex-1">{item.label}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {tab === 'base' ? (
        <PolicyEditor key="base" value={value.base} inherited={inherited} {...shared} onChange={(base) => onChange({ ...value, base })} />
      ) : (
        <PolicyEditor
          key={tab}
          value={value.types[tab] ?? {}}
          inherited={{ ...inherited, ...inheritedTypes?.[tab], ...value.base }}
          {...shared}
          onChange={(layer) => onChange({ ...value, types: { ...value.types, [tab]: layer } })}
        />
      )}
    </>
  );
}
