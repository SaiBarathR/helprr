'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { ThemeInspector } from '@/components/widgets/theme-inspector';
import { useIsMobile } from '@/hooks/use-is-mobile';

export default function ThemeSettingsPage() {
  const isMobile = useIsMobile();

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
        <h1 className="text-2xl font-semibold">Theme</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Accent color, palette, gradient, text tones, and font. Changes apply
          live across the whole app.
        </p>
      </div>

      <div className="px-4">
        <ThemeInspector mobile={isMobile} />
      </div>
    </div>
  );
}
