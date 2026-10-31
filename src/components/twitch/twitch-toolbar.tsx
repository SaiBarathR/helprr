'use client';

import type { ReactNode } from 'react';
import Link from '@/components/ui/app-link';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { TwitchSubNav } from './twitch-subnav';

const BUTTON = 'relative p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors disabled:opacity-60 disabled:cursor-default';
const PLAIN = 'hover:bg-accent active:bg-accent/80';
const FILLED = 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80';

export function toolbarButtonClass(filled = false): string {
  return cn(BUTTON, filled ? FILLED : PLAIN);
}

export function ToolbarButton({ label, href, onClick, disabled, filled, pressed, children }: {
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** The page's main action, or a mode that is switched on. */
  filled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Link href={href} aria-label={label} className={toolbarButtonClass(filled)}>{children}</Link>
        ) : (
          <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={toolbarButtonClass(filled)}
          >
            {children}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The same sticky two-row toolbar as the Movies and Torrents pages. */
export function TwitchToolbar({ active, actions, trailing, children }: {
  active: 'feed' | 'streamers' | 'queue';
  actions?: ReactNode;
  trailing?: ReactNode;
  /** Beside the section switch: the page's search, or its status. */
  children: ReactNode;
}) {
  return (
    <div className="page-toolbar page-toolbar-flush pb-2 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 space-y-2">
      <div className="flex w-full items-center overflow-x-auto scrollbar-hide md:gap-2">
        {actions}
        <div className="flex-1" />
        {trailing}
      </div>
      <div className="flex items-center gap-2">
        <TwitchSubNav active={active} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
