'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GroupedSection } from '@/components/settings/grouped-section';
import { hourLabel } from '@/lib/format';

interface QuietHours {
  quietHoursEnabled: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

const TRIGGER_CLASS =
  'w-auto h-auto border-0 bg-transparent px-2 py-1 gap-1 text-sm text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3.5 [&>svg]:w-3.5';

export function QuietHoursSection() {
  const [state, setState] = useState<QuietHours | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/me/settings');
        if (res.ok && active) setState((await res.json()) as QuietHours);
      } catch {
        /* leave defaults */
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function patch(next: Partial<QuietHours>) {
    const previous = state;
    setState((prev) => ({
      quietHoursEnabled: prev?.quietHoursEnabled ?? false,
      quietHoursStart: prev?.quietHoursStart ?? null,
      quietHoursEnd: prev?.quietHoursEnd ?? null,
      ...next,
    }));
    try {
      const res = await fetch('/api/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setState((await res.json()) as QuietHours);
    } catch {
      toast.error('Failed to save quiet hours');
      setState(previous);
    }
  }

  const enabled = state?.quietHoursEnabled ?? false;
  const start = state?.quietHoursStart ?? 23;
  const end = state?.quietHoursEnd ?? 7;

  function handleToggle(v: boolean) {
    // First time on with no window yet → seed a sensible default (23:00–07:00).
    if (v && (state?.quietHoursStart == null || state?.quietHoursEnd == null)) {
      void patch({ quietHoursEnabled: true, quietHoursStart: start, quietHoursEnd: end });
    } else {
      void patch({ quietHoursEnabled: v });
    }
  }

  return (
    <GroupedSection
      title="Quiet hours"
      footer="Applies to your account across all devices, in your timezone. Service-down and health alerts always come through."
    >
      <div className="grouped-row items-start">
        <div className="min-w-0 flex-1 pr-3">
          <div className="text-sm font-medium">Mute non-critical pushes</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Silence downloads, imports, and other routine alerts overnight.
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={loading}
          aria-label="Quiet hours"
        />
      </div>

      {enabled && (
        <>
          <div className="grouped-row">
            <span className="text-sm">From</span>
            <Select value={String(start)} onValueChange={(v) => void patch({ quietHoursStart: parseInt(v, 10) })}>
              <SelectTrigger className={TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {hourLabel(i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grouped-row">
            <span className="text-sm">Until</span>
            <Select value={String(end)} onValueChange={(v) => void patch({ quietHoursEnd: parseInt(v, 10) })}>
              <SelectTrigger className={TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {hourLabel(i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
    </GroupedSection>
  );
}
