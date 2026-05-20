'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { DiscoverLayoutSettings } from '@/components/settings/discover-layout-settings';

export default function DiscoverLayoutSettingsPage() {
  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings/appearance"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Appearance
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Discover layout</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose which sections appear on Discover and how they are filtered.
        </p>
      </div>

      <DiscoverLayoutSettings />
    </div>
  );
}
