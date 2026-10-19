'use client';

import { HeroCarousel } from '@/components/hero-carousel';
import type { DiscoverItem, DiscoverSection } from '@/types';
import type { DiscoverLayoutConfig, DiscoverLayoutSection } from '@/lib/discover-layout-config';
import type { DiscoverView } from './link-view';
import { CustomCarouselRow, DiscoverHeroSlide, DiscoverHomeSkeleton, SectionRow } from './discover-cards';

/** Discover's home: the hero, then the carousels in the saved layout's order, custom ones in place. */
export function DiscoverHomeSections({
  loadingSections,
  heroItems,
  layoutConfig,
  discoverContentType,
  customCarouselItems,
  customCarouselLoading,
  visibleSections,
  handleOpenItem,
  handleSeeAll,
  handleSeeAllCustom,
  pickGenre,
  pickProvider,
}: {
  loadingSections: boolean;
  heroItems: DiscoverItem[];
  layoutConfig: DiscoverLayoutConfig | null;
  discoverContentType: DiscoverView['contentType'];
  customCarouselItems: Record<string, DiscoverItem[]>;
  customCarouselLoading: Record<string, boolean>;
  visibleSections: DiscoverSection[];
  handleOpenItem: (item: DiscoverItem) => void;
  handleSeeAll: (section: DiscoverSection) => void;
  handleSeeAllCustom: (layoutSection: DiscoverLayoutSection) => void;
  pickGenre: (genreId: number, type: 'movie' | 'show') => void;
  pickProvider: (providerId: number, type: 'movie' | 'show') => void;
}) {
  return (
    <div className="space-y-5">
      {loadingSections ? (
        <DiscoverHomeSkeleton />
      ) : (
        <>
          {heroItems.length > 0 && (
            <HeroCarousel
              className="-mx-2 md:-mx-6 h-[280px] md:h-[380px]"
              slides={heroItems.map((item, i) => (
                <DiscoverHeroSlide key={item.id} item={item} priority={i === 0} />
              ))}
            />
          )}
          {/* Render sections in layout-config order, interleaving custom carousels */}
          {layoutConfig ? (
            layoutConfig.sections
              .filter((entry) => entry.enabled)
              .map((entry) => {
                if (entry.type === 'custom' && entry.filters) {
                  // Apply content type filter to custom carousels too
                  if (discoverContentType !== 'all') {
                    const ct = entry.filters.contentType;
                    if (ct !== 'all') {
                      if (discoverContentType === 'movie' && ct !== 'movie') return null;
                      if (discoverContentType === 'show' && ct !== 'show') return null;
                    }
                  }
                  return (
                    <CustomCarouselRow
                      key={entry.id}
                      layoutSection={entry}
                      items={customCarouselItems[entry.id] ?? []}
                      loading={customCarouselLoading[entry.id] ?? true}
                      onOpenItem={handleOpenItem}
                      onSeeAll={handleSeeAllCustom}
                    />
                  );
                }

                // Built-in section — find it in the ordered list
                const apiSection = visibleSections.find((s) => s.key === entry.id);
                if (!apiSection) return null;
                return (
                  <SectionRow
                    key={apiSection.key}
                    section={apiSection}
                    onOpenItem={handleOpenItem}
                    onSeeAll={handleSeeAll}
                    onPickGenre={pickGenre}
                    onPickProvider={pickProvider}
                  />
                );
              })
          ) : (
            visibleSections.map((section) => (
              <SectionRow
                key={section.key}
                section={section}
                onOpenItem={handleOpenItem}
                onSeeAll={handleSeeAll}
                onPickGenre={pickGenre}
                onPickProvider={pickProvider}
              />
            ))
          )}
        </>
      )}
    </div>
  );
}
