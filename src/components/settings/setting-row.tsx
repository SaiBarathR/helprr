'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BaseProps {
  icon?: LucideIcon;
  iconColor?: string;
  label: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  className?: string;
  destructive?: boolean;
}

interface LinkRowProps extends BaseProps {
  href: string;
  onClick?: never;
  control?: never;
  disabled?: never;
}

interface ButtonRowProps extends BaseProps {
  href?: never;
  onClick: () => void;
  control?: never;
  disabled?: boolean;
}

interface ControlRowProps extends BaseProps {
  href?: never;
  onClick?: never;
  control: ReactNode;
  disabled?: never;
}

interface StaticRowProps extends BaseProps {
  href?: never;
  onClick?: never;
  control?: never;
  disabled?: never;
}

export type SettingRowProps = LinkRowProps | ButtonRowProps | ControlRowProps | StaticRowProps;

function RowBody({
  icon: Icon,
  iconColor,
  label,
  description,
  value,
  control,
  showChevron,
  destructive,
}: BaseProps & { control?: ReactNode; showChevron?: boolean }) {
  return (
    <>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {Icon && (
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md bg-[oklch(1_0_0/6%)] text-foreground/80 shrink-0',
              iconColor,
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex flex-col items-start">
          <span
            className={cn(
              'text-sm font-medium truncate',
              destructive && 'text-red-500',
            )}
          >
            {label}
          </span>
          {description && (
            <span className="text-xs text-muted-foreground truncate">{description}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {value !== undefined && (
          <span className="text-sm text-muted-foreground text-right max-w-[220px] truncate">
            {value}
          </span>
        )}
        {control}
        {showChevron && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </div>
    </>
  );
}

export function SettingRow(props: SettingRowProps) {
  const { className } = props;

  if ('href' in props && props.href) {
    return (
      <Link
        href={props.href}
        className={cn('grouped-row hover:bg-[oklch(1_0_0/3%)] active:bg-white/5 transition-colors', className)}
      >
        <RowBody {...props} showChevron />
      </Link>
    );
  }

  if ('onClick' in props && props.onClick) {
    return (
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        className={cn(
          'grouped-row w-full text-left active:bg-white/5 transition-colors disabled:opacity-50',
          className,
        )}
      >
        <RowBody {...props} showChevron />
      </button>
    );
  }

  return (
    <div className={cn('grouped-row', className)}>
      <RowBody {...props} control={'control' in props ? props.control : undefined} />
    </div>
  );
}
