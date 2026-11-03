'use client';

import { Fragment, type ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import Link from '@/components/ui/app-link';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { normalizeContextActionGroups, type ContextAction, type ContextActionGroup } from '@/components/ui/quick-context-menu';

function ActionItem({ action }: { action: ContextAction }) {
  const variant = action.destructive ? 'destructive' : undefined;
  if (!action.href) {
    return (
      <DropdownMenuItem variant={variant} disabled={action.disabled || action.pending} onSelect={action.onSelect}>
        {action.icon}
        {action.label}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild variant={variant} disabled={action.disabled}>
      {action.external ? (
        <a href={action.href} target="_blank" rel="noopener noreferrer">{action.icon}{action.label}</a>
      ) : (
        <Link href={action.href}>{action.icon}{action.label}</Link>
      )}
    </DropdownMenuItem>
  );
}

/** The visible way to reach what a long press or right click offers. */
export function ActionsMenu({ label, groups, className, icon }: {
  label: string;
  groups: ContextActionGroup[];
  className?: string;
  icon?: ReactNode;
}) {
  const visible = normalizeContextActionGroups(groups);
  if (visible.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={label} className={className}>
        {icon ?? <MoreVertical className="h-4 w-4" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {visible.map((group, index) => (
          <Fragment key={group.id ?? index}>
            {index > 0 && <DropdownMenuSeparator />}
            {group.actions.map((action) => <ActionItem key={action.id} action={action} />)}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
