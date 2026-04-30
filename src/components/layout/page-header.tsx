'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  showBack?: boolean;
  onBack?: () => void;
  rightContent?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  showBack = true,
  onBack,
  rightContent,
  className,
}: PageHeaderProps) {
  const router = useRouter();

  return (
    <header
      className={cn(
        'sticky z-40 bg-background/75 backdrop-blur-xl',
        className
      )}
      style={{ top: 'var(--header-height, 0px)' }}
    >
      {/* Hairline rule under header */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px pointer-events-none"
        style={{ background: 'var(--hairline)' }}
      />
      <div className="flex items-center h-12 px-1">
        {showBack && (
          <button
            onClick={onBack || (() => router.back())}
            className="press-feedback group flex items-center gap-0.5 text-primary min-w-[44px] min-h-[44px] justify-center -ml-1"
            aria-label="Back"
          >
            <ChevronLeft className="h-5 w-5 transition-transform group-active:-translate-x-0.5" />
            <span className="sr-only">Back</span>
          </button>
        )}

        <div className="flex-1 min-w-0 px-2">
          {subtitle && (
            <p className="tracked-caps text-[9px] text-muted-foreground/80 truncate leading-tight">
              {subtitle}
            </p>
          )}
          <h1 className="text-[15px] font-semibold tracking-tight truncate leading-tight">
            {title}
          </h1>
        </div>

        {rightContent && (
          <div className="flex items-center gap-0.5 shrink-0 pr-1">
            {rightContent}
          </div>
        )}
      </div>
    </header>
  );
}
