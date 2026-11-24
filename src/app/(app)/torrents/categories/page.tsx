'use client';

import { useMemo } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useMe } from '@/components/permission-provider';
import { categoryFolder, NEW_CATEGORY_HREF, editCategoryHref } from '../_components/category-links';
import { useCategoryDetails } from '../_components/use-categories';

export default function TorrentCategoriesPage() {
  const isAdmin = useMe()?.role === 'admin';
  const detailsQuery = useCategoryDetails();
  const details = detailsQuery.data;
  const categories = useMemo(
    () => Object.values(details?.categories ?? {}).sort((a, b) => a.name.localeCompare(b.name)),
    [details],
  );

  return (
    <div className="animate-content-in">
      <PageHeader title="Categories" className="*:readable-column" backHref="/torrents/settings" />

      <div className="mt-3 pb-8 readable-column">
        {detailsQuery.isLoading ? (
          <PageSpinner />
        ) : !details ? (
          <ErrorState
            message="Failed to load qBittorrent's categories."
            onRetry={() => void detailsQuery.refetch()}
            retrying={detailsQuery.isFetching}
          />
        ) : (
          <>
            <GroupedSection
              title="qBittorrent Categories"
              footer={isAdmin
                ? 'Sonarr, Radarr and Lidarr find their downloads by category: check their download clients before removing one.'
                : 'Only an admin can add, change or remove categories.'}
            >
              {categories.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">No categories yet</p>
              )}
              {categories.map((category) => {
                const content = (
                  <div className="min-w-0 flex-1 flex flex-col">
                    <span className="text-[15px] font-medium truncate">{category.name}</span>
                    <span className="text-xs text-muted-foreground truncate">
                      {categoryFolder(category, details.defaultSavePath)}
                    </span>
                  </div>
                );
                return isAdmin ? (
                  <Link
                    key={category.name}
                    href={editCategoryHref(category.name)}
                    className="grouped-row gap-3 hover:bg-foreground/[0.03] active:bg-foreground/5 transition-colors"
                  >
                    {content}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                ) : (
                  <div key={category.name} className="grouped-row gap-3">{content}</div>
                );
              })}
            </GroupedSection>

            {isAdmin && (
              <GroupedSection>
                <div className="px-4 py-3">
                  <Button variant="outline" asChild className="w-full h-11">
                    <Link href={NEW_CATEGORY_HREF}>
                      <Plus className="mr-2 h-4 w-4" />
                      New category
                    </Link>
                  </Button>
                </div>
              </GroupedSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}
