'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { NavOrderSettings } from '@/components/settings/nav-order-settings';
import { AnimeCarouselSettings } from '@/components/settings/anime-carousel-settings';
import { InstallAppSection } from '@/components/settings/install-app-section';
import { GroupedSection } from '@/components/settings/grouped-section';
import { CategoryRow } from '@/components/settings/category-row';
import { Switch } from '@/components/ui/switch';
import { useUIStore } from '@/lib/store';
import { haptic } from '@/lib/haptics';
import { Clapperboard, Compass, Image as ImageIcon, Paintbrush, PlayCircle, Vibrate } from 'lucide-react';

function HapticsSection() {
  const hapticsEnabled = useUIStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useUIStore((s) => s.setHapticsEnabled);

  return (
    <GroupedSection title="Touch" footer="Vibration on swipe actions and pull-to-refresh. Not supported on all devices.">
      <div className="grouped-row">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-violet-500/10 text-violet-400">
            <Vibrate className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex flex-col items-start">
            <span className="text-[15px] font-medium truncate">Haptic feedback</span>
          </div>
        </div>
        <Switch
          checked={hapticsEnabled}
          onCheckedChange={(v) => {
            setHapticsEnabled(v);
            // Demo tick so enabling is immediately felt.
            if (v) haptic('medium');
          }}
        />
      </div>
    </GroupedSection>
  );
}

function WatchSkinSection() {
  const watchSkin = useUIStore((s) => s.watchSkin);
  const setWatchSkin = useUIStore((s) => s.setWatchSkin);
  const watchPreviews = useUIStore((s) => s.watchPreviews);
  const setWatchPreviews = useUIStore((s) => s.setWatchPreviews);
  const cinematic = watchSkin === 'cinematic';

  return (
    <GroupedSection
      title="Watch"
      footer="Cinematic mode gives the Watch section a streaming-service layout: artwork without captions, a billboard hero, and chrome that gets out of the way. Always dark, whatever your theme. Autoplay previews stream a muted clip of the title — your server may have to transcode for it, so turn them off if playback elsewhere suffers."
    >
      <div className="grouped-row">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-rose-500/10 text-rose-400">
            <Clapperboard className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex flex-col items-start">
            <span className="text-[15px] font-medium truncate">Cinematic mode</span>
          </div>
        </div>
        <Switch
          checked={cinematic}
          onCheckedChange={(v) => setWatchSkin(v ? 'cinematic' : 'classic')}
          aria-label="Cinematic mode"
        />
      </div>
      <div className="grouped-row">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-teal-500/10 text-teal-400">
            <PlayCircle className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex flex-col items-start">
            <span className="text-[15px] font-medium truncate">Autoplay previews</span>
            {!cinematic && (
              <span className="text-[13px] text-muted-foreground">Needs cinematic mode</span>
            )}
          </div>
        </div>
        <Switch
          checked={watchPreviews}
          disabled={!cinematic}
          onCheckedChange={setWatchPreviews}
          aria-label="Autoplay previews"
        />
      </div>
    </GroupedSection>
  );
}

function CalendarBackdropSection() {
  const imageOpacity = useUIStore((s) => s.calendarImageOpacity);
  const setImageOpacity = useUIStore((s) => s.setCalendarImageOpacity);

  return (
    <GroupedSection title="Calendar" footer="How visible the artwork behind calendar rows is when images are enabled.">
      <div className="grouped-row">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-sky-500/10 text-sky-400">
            <ImageIcon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex flex-col items-start">
            <span className="text-[15px] font-medium truncate">Backdrop opacity</span>
          </div>
        </div>
        <div className="flex items-center gap-2 w-[160px] shrink-0">
          <input
            type="range"
            min={0}
            max={100}
            value={imageOpacity}
            onChange={(e) => setImageOpacity(Number(e.target.value))}
            aria-label="Calendar backdrop opacity"
            className="flex-1 min-w-0"
            style={{ accentColor: 'var(--primary)' }}
          />
          <span className="text-sm text-muted-foreground tabular-nums w-10 text-right">
            {imageOpacity}%
          </span>
        </div>
      </div>
    </GroupedSection>
  );
}

export default function AppearanceSettingsPage() {
  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Appearance & Layout</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Customize how Helprr looks. These changes save automatically to this device.
        </p>
      </div>

      <div className="px-4 pb-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
        This device only — won&apos;t sync to other phones or browsers
      </div>
      <GroupedSection title="Theme">
        <CategoryRow
          href="/settings/appearance/theme"
          icon={Paintbrush}
          iconBg="bg-cyan-500/10"
          iconColor="text-cyan-400"
          label="Theme"
          subtitle="Accent color, palette, gradient, text, and font"
        />
      </GroupedSection>

      <WatchSkinSection />

      <HapticsSection />

      <CalendarBackdropSection />

      <NavOrderSettings />
      <AnimeCarouselSettings />

      <GroupedSection title="Discover" footer="Synced across devices">
        <CategoryRow
          href="/settings/appearance/discover-layout"
          icon={Compass}
          iconBg="bg-amber-500/10"
          iconColor="text-amber-400"
          label="Discover layout"
          subtitle="Sections, filters, and language/region"
        />
      </GroupedSection>

      <div className="px-4 pb-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
        This device only
      </div>
      <InstallAppSection />
    </div>
  );
}
