'use client';

import Link from 'next/link';
import { ChevronDown, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface OpenInInstance {
  instanceId: string;
  instanceLabel: string;
  id: number;
  titleSlug?: string;
}

interface OpenInInstancesProps {
  type: 'movie' | 'series';
  /** Every instance that holds the title. Single entry → plain link; 2+ → dropdown. */
  instances: OpenInInstance[];
  label: string;
  /** Pill classes from the caller so each entry point keeps its own styling. */
  className: string;
}

/**
 * "Open in …" affordance for a title that may live in more than one Sonarr/Radarr
 * instance. With one instance it renders the same single pill as before; with two
 * or more it becomes a dropdown listing each instance so the user can open any copy.
 */
export function OpenInInstances({ type, instances, label, className }: OpenInInstancesProps) {
  if (instances.length === 0) return null;

  const base = type === 'movie' ? '/movies' : '/series';
  // A series/movie id is only unique within an instance, so carry ?instance= so the
  // detail page loads (and caches) the right instance.
  const hrefFor = (inst: OpenInInstance) =>
    `${base}/${inst.id}${inst.instanceId ? `?instance=${inst.instanceId}` : ''}`;

  if (instances.length === 1) {
    return (
      <Link href={hrefFor(instances[0])} className={className}>
        <Sparkles className="h-3.5 w-3.5" />
        <span className="tracking-widest uppercase">{label}</span>
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={className}>
        <Sparkles className="h-3.5 w-3.5" />
        <span className="tracking-widest uppercase">{label}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {instances.map((inst) => (
          <DropdownMenuItem key={inst.instanceId} asChild>
            <Link href={hrefFor(inst)}>{inst.instanceLabel || inst.instanceId}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
