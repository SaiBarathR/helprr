'use client';

import Link from 'next/link';

export function Header() {
  return (
    <header className="md:hidden sticky top-0 z-40 border-b border-border/50 bg-background/70 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
      {/* Hairline glow */}
      <div
        aria-hidden
        className="absolute inset-x-6 bottom-0 h-px pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--amber-soft), transparent)',
        }}
      />
      <div className="flex items-center h-12 px-4">
        <Link href="/dashboard" className="flex items-baseline gap-2">
          <span className="font-display text-xl leading-none tracking-[-0.04em] font-medium">
            <span className="italic">Help</span>
            <span style={{ color: 'var(--amber)' }}>rr</span>
          </span>
          <span className="marquee-dot translate-y-[-1px]" />
        </Link>
      </div>
    </header>
  );
}
