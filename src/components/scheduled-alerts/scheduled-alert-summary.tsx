'use client';

import { Badge } from '@/components/ui/badge';
import { offsetLabel } from '@/lib/scheduled-alerts/constants';
import type { ReleaseKind } from '@/lib/scheduled-alerts/types';
import { RELEASE_KIND_LABELS } from '@/lib/scheduled-alerts/constants';

interface Props {
  scheduleMode: string;
  releaseTypes?: ReleaseKind[];
  offsetMinutes?: number;
  releaseKindLabel?: string;
  className?: string;
}

export function ScheduledAlertSummary({
  scheduleMode,
  releaseTypes = [],
  offsetMinutes = 0,
  releaseKindLabel,
  className,
}: Props) {
  return (
    <div className={`flex flex-wrap gap-1 ${className ?? ''}`}>
      <Badge variant="secondary" className="text-[10px]">
        {scheduleMode === 'absolute' ? 'Custom' : 'Release'}
      </Badge>
      {releaseKindLabel ? (
        <Badge variant="outline" className="text-[10px]">
          {releaseKindLabel}
        </Badge>
      ) : (
        releaseTypes.slice(0, 2).map((k) => (
          <Badge key={k} variant="outline" className="text-[10px]">
            {RELEASE_KIND_LABELS[k]}
          </Badge>
        ))
      )}
      {scheduleMode === 'release_relative' && (
        <Badge variant="outline" className="text-[10px]">
          {offsetLabel(offsetMinutes)}
        </Badge>
      )}
    </div>
  );
}
