'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { GroupedSection } from '@/components/settings/grouped-section';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys, type ArrService } from '@/lib/query-keys';
import type { QualityProfileSummary } from '@/types';
import { cn } from '@/lib/utils';

const APP_NAME: Record<ArrService, string> = { sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr' };

function signed(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

function scoreTone(score: number): string {
  return score > 0
    ? 'text-emerald-500 border-emerald-500/40'
    : score < 0
      ? 'text-rose-500 border-rose-500/40'
      : 'text-muted-foreground';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grouped-row gap-4">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

function ProfileBody({ profile }: { profile: QualityProfileSummary }) {
  const hasFormats = profile.formats.length > 0;
  return (
    <>
      <GroupedSection className="mb-4">
        <Row label="Upgrades" value={profile.upgradeAllowed ? 'Allowed' : 'Off'} />
        {profile.upgradeAllowed && <Row label="Upgrade until" value={profile.cutoff ?? 'Unknown'} />}
        {profile.language && <Row label="Language" value={profile.language} />}
        {hasFormats && profile.minFormatScore !== null && (
          <Row label="Minimum format score" value={signed(profile.minFormatScore)} />
        )}
        {hasFormats && profile.upgradeAllowed && profile.cutoffFormatScore !== null && (
          <Row label="Upgrade until score" value={signed(profile.cutoffFormatScore)} />
        )}
        {hasFormats && profile.upgradeAllowed && profile.minUpgradeFormatScore !== null && (
          <Row label="Minimum score increase" value={signed(profile.minUpgradeFormatScore)} />
        )}
      </GroupedSection>

      <GroupedSection title="Qualities" footer="Most preferred first." className="mb-4">
        {profile.qualities.length === 0 ? (
          <div className="grouped-row text-sm text-muted-foreground">No quality is allowed.</div>
        ) : (
          profile.qualities.map((quality, index) => (
            <div key={`${quality.name}-${index}`} className="grouped-row gap-3">
              <div className="min-w-0">
                <p className="text-sm [overflow-wrap:anywhere]">{quality.name}</p>
                {quality.members.length > 0 && (
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {quality.members.join(', ')}
                  </p>
                )}
              </div>
              {quality.isCutoff && profile.upgradeAllowed && (
                <Badge variant="outline" className="shrink-0 text-[10px] text-primary border-primary/40">
                  Cutoff
                </Badge>
              )}
            </div>
          ))
        )}
      </GroupedSection>

      <GroupedSection title="Custom formats" className="mb-2">
        {hasFormats ? (
          profile.formats.map((format, index) => (
            <div key={`${format.name}-${index}`} className="grouped-row gap-3">
              <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{format.name}</span>
              <Badge variant="outline" className={`shrink-0 text-[10px] tabular-nums ${scoreTone(format.score)}`}>
                {signed(format.score)}
              </Badge>
            </div>
          ))
        ) : (
          <div className="grouped-row text-sm text-muted-foreground">No custom formats on this instance.</div>
        )}
      </GroupedSection>
    </>
  );
}

/**
 * What a quality profile asks for, read-only: its allowed qualities and cutoff,
 * whether it upgrades, and its custom format scores, so "cutoff unmet" or a
 * title that keeps upgrading can be explained without opening the *arr app.
 */
export function QualityProfileSheet({
  service,
  instanceId,
  profileId,
  profileName,
  open,
  onOpenChange,
}: {
  service: ArrService;
  instanceId?: string;
  profileId: number | undefined;
  /** Shown while the profile loads. */
  profileName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const query = useQuery({
    queryKey: [...queryKeys.qualityProfiles(service, instanceId), profileId],
    queryFn: jsonFetcher<QualityProfileSummary>(`/api/${service}/qualityprofiles/${profileId}`, instanceId),
    enabled: open && profileId != null,
    staleTime: 60_000,
  });
  const profile = query.data;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent size="content">
        <DrawerHeader>
          <DrawerTitle>{profile?.name ?? profileName ?? 'Quality profile'}</DrawerTitle>
          <DrawerDescription>
            {query.isError
              ? `Could not read this profile from ${APP_NAME[service]}.`
              : `Quality profile, as set in ${APP_NAME[service]}.`}
          </DrawerDescription>
        </DrawerHeader>
        <div className="mx-auto w-full max-w-md flex-1 min-h-0 overflow-y-auto px-4">
          {query.isLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : profile ? (
            <ProfileBody profile={profile} />
          ) : null}
        </div>
        <DrawerFooter className="mx-auto w-full max-w-md">
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">Done</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * An Information row's profile name, as the button that opens the sheet. The
 * negative margin lets its 44px target sit in a 20px line without making the
 * row taller than its neighbours.
 */
export function QualityProfileValue({
  name,
  onOpen,
  className = '-my-3',
}: {
  name: string;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn(
        'ml-4 inline-flex min-h-[44px] min-w-[44px] max-w-[60%] items-center justify-end gap-0.5 text-right text-sm text-primary hover:underline',
        className,
      )}
    >
      <span className="min-w-0 break-words">{name}</span>
      <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
    </button>
  );
}
