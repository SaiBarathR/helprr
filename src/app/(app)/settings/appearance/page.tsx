'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { NavOrderSettings } from '@/components/settings/nav-order-settings';
import { AnimeCarouselSettings } from '@/components/settings/anime-carousel-settings';
import { InstallAppSection } from '@/components/settings/install-app-section';
import { GroupedSection } from '@/components/settings/grouped-section';
import { CategoryRow } from '@/components/settings/category-row';
import { Compass, Paintbrush } from 'lucide-react';

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
