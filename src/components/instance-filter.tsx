'use client';

import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface InstanceOption {
  id: string;
  label: string;
}

/**
 * Collect the distinct instances present in an already-tagged list of items
 * (preserving first-seen order). Used to build the options for {@link InstanceFilter}.
 */
export function deriveInstances<T extends { instanceId?: string; instanceLabel?: string }>(
  items: T[]
): InstanceOption[] {
  const map = new Map<string, string>();
  for (const item of items) {
    if (item.instanceId && !map.has(item.instanceId)) {
      map.set(item.instanceId, item.instanceLabel ?? item.instanceId);
    }
  }
  return Array.from(map, ([id, label]) => ({ id, label }));
}

/**
 * A compact "filter by instance" dropdown for aggregated views (calendar,
 * activity, history). Renders nothing unless there is more than one instance —
 * single-instance setups see no UI change. `value` is `'all'` or an instanceId.
 */
export function InstanceFilter({
  instances,
  value,
  onChange,
  align = 'end',
}: {
  instances: InstanceOption[];
  value: string;
  onChange: (id: string) => void;
  align?: 'start' | 'center' | 'end';
}) {
  if (instances.length <= 1) return null;

  const current = value === 'all' ? 'All instances' : (instances.find((i) => i.id === value)?.label ?? 'All instances');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Layers className="h-3.5 w-3.5" />
          <span className="max-w-[10rem] truncate">{current}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuLabel>Instance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={value === 'all'} onCheckedChange={() => onChange('all')}>
          All instances
        </DropdownMenuCheckboxItem>
        {instances.map((inst) => (
          <DropdownMenuCheckboxItem
            key={inst.id}
            checked={value === inst.id}
            onCheckedChange={() => onChange(inst.id)}
          >
            {inst.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
