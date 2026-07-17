'use client';

import { Server } from 'lucide-react';
import type { AddPageInstance } from '@/lib/add-page-instances';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AddPageInstanceSelectProps {
  instances: AddPageInstance[];
  value?: string;
  onChange: (instanceId: string) => void;
  disabled?: boolean;
}

export function AddPageInstanceSelect({
  instances,
  value,
  onChange,
  disabled = false,
}: AddPageInstanceSelectProps) {
  if (instances.length <= 1) return null;

  const currentLabel = instances.find((instance) => instance.id === value)?.label ?? 'Select instance';

  return (
    <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        className="h-8 max-w-[9.5rem] gap-1.5 border-border/70 bg-background/70 px-2 shadow-none sm:max-w-[13rem]"
        aria-label="Target instance"
        title={`Target instance: ${currentLabel}`}
      >
        <Server className="size-3.5 shrink-0 text-muted-foreground" />
        <SelectValue>{currentLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {instances.map((instance) => (
          <SelectItem key={instance.id} value={instance.id}>
            {instance.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
