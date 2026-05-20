import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface GroupedSectionProps {
  title?: string;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function GroupedSection({ title, footer, className, children }: GroupedSectionProps) {
  return (
    <div className={cn('grouped-section mb-6', className)}>
      {title && <div className="grouped-section-title">{title}</div>}
      <div className="grouped-section-content">{children}</div>
      {footer && (
        <div className="px-4 pt-2 text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
          {footer}
        </div>
      )}
    </div>
  );
}
