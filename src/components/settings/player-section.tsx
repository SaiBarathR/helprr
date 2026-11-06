'use client';

import { GroupedSection } from '@/components/settings/grouped-section';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SKIP_LENGTH_OPTIONS } from '@/lib/jellyfin-playback/skip-length';
import { useUIStore } from '@/lib/store';

// The Preferences row style, as in the Subtitles section below it.
const TRIGGER_CLASS = 'w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring [&>svg]:h-3.5 [&>svg]:w-3.5';

function SkipRow({ label, value, onChange }: { label: string; value: number; onChange: (seconds: number) => void }) {
  return (
    <div className="grouped-row">
      <span className="text-sm">{label}</span>
      <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
        <SelectTrigger aria-label={label} className={TRIGGER_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SKIP_LENGTH_OPTIONS.map((seconds) => (
            <SelectItem key={seconds} value={String(seconds)}>{seconds} seconds</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The Watch player's skip lengths. Same store values as the player's gear panel. */
export function PlayerSection() {
  const skipBack = useUIStore((state) => state.playerSkipBackSeconds);
  const skipForward = useUIStore((state) => state.playerSkipForwardSeconds);
  const setSkipBack = useUIStore((state) => state.setPlayerSkipBackSeconds);
  const setSkipForward = useUIStore((state) => state.setPlayerSkipForwardSeconds);

  return (
    <GroupedSection
      title="Player"
      footer="Saved on this device. Used by the player's back and forward buttons, double-tap, the arrow keys and the lock-screen controls."
    >
      <SkipRow label="Skip back" value={skipBack} onChange={setSkipBack} />
      <SkipRow label="Skip forward" value={skipForward} onChange={setSkipForward} />
    </GroupedSection>
  );
}
