'use client';

import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightContent?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, showBack = true, onBack, rightContent, className }: PageHeaderProps) {
  const router = useRouter();

  return (
    <header
      className={cn(
        'sticky top-0 z-40 bg-background/80 backdrop-blur-lg',
        className
      )}
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        marginTop: 'calc(-1 * env(safe-area-inset-top, 0px))',
      }}
    >
      <div className="flex items-center h-11 px-1">
        {/* Left: back button */}
        {showBack && (
          <button
            onClick={onBack || (() => router.back())}
            className="flex items-center gap-0 text-primary min-w-[44px] min-h-[44px] justify-center -ml-1"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {/* Center: title */}
        <div className="flex-1 min-w-0 px-2">
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate leading-tight">{subtitle}</p>
          )}
          <h1 className="text-base font-semibold truncate leading-tight">{title}</h1>
        </div>

        {/* Right: action slots */}
        {rightContent && (
          <div className="flex items-center gap-0.5 shrink-0">
            {rightContent}
          </div>
        )}
      </div>
    </header>
  );
}
