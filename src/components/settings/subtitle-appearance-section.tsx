'use client';

import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUIStore } from '@/lib/store';
import {
  DROP_SHADOW_OPTIONS,
  FONT_OPTIONS,
  TEXT_BACKGROUND_OPTIONS,
  TEXT_COLOR_OPTIONS,
  TEXT_SIZE_OPTIONS,
  subtitleCueDeclarations,
  type SubtitleAppearance,
} from '@/lib/jellyfin-playback/subtitle-appearance';
import { cn } from '@/lib/utils';

const TRIGGER_CLASS = 'w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5';

function SelectRow<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grouped-row">
      <span className="text-sm">{label}</span>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger aria-label={`Subtitle ${label.toLowerCase()}`} className={TRIGGER_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The ::cue declarations as a React style, so the preview matches the player. */
function previewStyle(appearance: SubtitleAppearance): React.CSSProperties {
  return Object.fromEntries(
    subtitleCueDeclarations(appearance).map(([property, value]) => [property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), value]),
  );
}

/**
 * The player's subtitle appearance settings, for changing them without a title
 * open. Same store value as the player's subtitle panel.
 */
export function SubtitleAppearanceSection() {
  const appearance = useUIStore((state) => state.subtitleAppearance);
  const setAppearance = useUIStore((state) => state.setSubtitleAppearance);
  const resetAppearance = useUIStore((state) => state.resetSubtitleAppearance);

  return (
    <GroupedSection
      title="Subtitles"
      footer="Saved on this device. Applies to text subtitles (SRT, WebVTT) in the Watch player; ASS/SSA subtitles keep their own styling."
    >
      <SelectRow label="Size" value={appearance.textSize} options={TEXT_SIZE_OPTIONS} onChange={(textSize) => setAppearance({ textSize })} />
      <SelectRow label="Font" value={appearance.font} options={FONT_OPTIONS} onChange={(font) => setAppearance({ font })} />
      <SelectRow label="Edge" value={appearance.dropShadow} options={DROP_SHADOW_OPTIONS} onChange={(dropShadow) => setAppearance({ dropShadow })} />
      <SelectRow label="Background" value={appearance.textBackground} options={TEXT_BACKGROUND_OPTIONS} onChange={(textBackground) => setAppearance({ textBackground })} />
      <div className="grouped-row">
        <span className="text-sm">Colour</span>
        <span className="flex gap-1.5">
          {TEXT_COLOR_OPTIONS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Subtitle colour ${color}`}
              aria-pressed={appearance.textColor === color}
              onClick={() => setAppearance({ textColor: color })}
              className={cn(
                'relative touch-target size-6 rounded-full border-2',
                appearance.textColor === color ? 'border-primary' : 'border-foreground/20',
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
      </div>
      <div className="grouped-row">
        <span className="text-sm">Position <span className="text-muted-foreground">{appearance.verticalPosition}</span></span>
        <span className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setAppearance({ verticalPosition: Math.max(-16, appearance.verticalPosition - 1) })}>Lower</Button>
          <Button size="sm" variant="outline" onClick={() => setAppearance({ verticalPosition: Math.min(16, appearance.verticalPosition + 1) })}>Raise</Button>
        </span>
      </div>
      <div className="px-4 py-3 border-b border-foreground/[0.06]">
        <div className="flex h-20 items-end justify-center rounded-lg bg-black pb-3 text-sm">
          <span data-testid="subtitle-preview" style={previewStyle(appearance)}>Preview subtitle text</span>
        </div>
      </div>
      <div className="grouped-row">
        <span className="text-sm text-muted-foreground">Back to the player&apos;s defaults</span>
        <Button size="sm" variant="outline" onClick={resetAppearance}>Reset</Button>
      </div>
    </GroupedSection>
  );
}
