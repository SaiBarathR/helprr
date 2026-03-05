'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function Carousel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="relative">
      <div className={`flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide -mx-1 px-1 ${className}`}>
        {children}
      </div>
      <div className="pointer-events-none absolute top-0 right-0 bottom-2 w-8 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}

export function SectionHeader({ title, href, linkText = 'View all', badge }: { title: string; href?: string; linkText?: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {badge}
      </div>
      {href && (
        <Link href={href} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-0.5">
          {linkText} <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

export function EditModePlaceholder({ title, message = 'No activity' }: { title: string; message?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/60 py-8 px-4 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
