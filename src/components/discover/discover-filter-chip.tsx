'use client';

import type { ReactNode } from 'react';
import Link from '@/components/ui/app-link';
import { useCan } from '@/components/permission-provider';

/**
 * A studio, network or company chip that opens Discover filtered by it. Title
 * pages are also open to members without discover.view, and for them the
 * Discover home is a not-found page, so the chip shows as plain text instead.
 */
export function DiscoverFilterChip({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const canDiscover = useCan('discover.view');
  if (!canDiscover) return <span className={className}>{children}</span>;
  return <Link href={href} className={className}>{children}</Link>;
}
