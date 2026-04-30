'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export function Carousel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="relative">
      <div className={`flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide -mx-1 px-1 ${className}`}>
        {children}
      </div>
      {/* Soft fade-out edges */}
      <div className="pointer-events-none absolute top-0 left-0 bottom-2 w-6 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute top-0 right-0 bottom-2 w-10 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}

export function SectionHeader({
  title,
  href,
  linkText = 'View all',
  badge,
  eyebrow,
}: {
  title: string;
  href?: string;
  linkText?: string;
  badge?: React.ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <span className="tracked-caps text-[10px] text-muted-foreground/80 mb-1 inline-block">
            {eyebrow}
          </span>
        )}
        <div className="flex items-center gap-2.5">
          <h2 className="font-display text-[20px] leading-none tracking-[-0.02em] font-medium truncate">
            {title}
          </h2>
          {badge}
          {/* Hairline rule extending to right */}
          <span
            aria-hidden
            className="hidden sm:block flex-1 h-px"
            style={{ background: 'var(--hairline)' }}
          />
        </div>
      </div>
      {href && (
        <Link
          href={href}
          className="group shrink-0 flex items-center gap-1 text-[11px] tracked-caps text-muted-foreground hover:text-primary transition-colors"
        >
          <span>{linkText}</span>
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

export function EditModePlaceholder({
  title,
  message = 'No activity',
}: {
  title: string;
  message?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-card/40 backdrop-blur-sm py-8 px-4 text-center">
      <div className="flex justify-center mb-2">
        <span className="reel" />
      </div>
      <p className="text-[13px] font-semibold tracking-tight">{title}</p>
      <p className="mt-1 text-[11px] tracked-mid text-muted-foreground/80">
        {message}
      </p>
    </div>
  );
}
