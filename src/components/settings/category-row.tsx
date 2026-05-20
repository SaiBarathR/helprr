'use client';

import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CategoryRowProps {
  href: string;
  icon: LucideIcon;
  iconBg?: string;
  iconColor?: string;
  label: string;
  subtitle?: string;
  badge?: string;
  className?: string;
}

export function CategoryRow({
  href,
  icon: Icon,
  iconBg = 'bg-[oklch(1_0_0/6%)]',
  iconColor = 'text-foreground/80',
  label,
  subtitle,
  badge,
  className,
}: CategoryRowProps) {
  return (
    <Link
      href={href}
      className={cn(
        'grouped-row hover:bg-[oklch(1_0_0/3%)] active:bg-white/5 transition-colors',
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-md shrink-0', iconBg, iconColor)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex flex-col items-start">
          <span className="text-[15px] font-medium truncate">{label}</span>
          {subtitle && (
            <span className="text-xs text-muted-foreground truncate">{subtitle}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {badge && (
          <span className="text-xs text-muted-foreground">{badge}</span>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </Link>
  );
}
