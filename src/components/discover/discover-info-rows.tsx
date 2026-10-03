'use client';

import type { ReactNode } from 'react';

interface InfoRow {
  label: string;
  value: string;
  valueNode?: ReactNode;
}

interface DiscoverInfoRowsProps {
  title: string;
  rows: InfoRow[];
}

export function DiscoverInfoRows({ title, rows }: DiscoverInfoRowsProps) {
  if (!rows.length) return null;

  return (
    // Its own container, so .detail-info-rows can split the rows into two
    // columns on wide pages that have no other @container around them.
    <div className="@container">
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      <div className="detail-info-rows">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex justify-between items-start py-2.5 border-b border-border/40 last:border-b-0"
          >
            <span className="text-sm text-muted-foreground shrink-0">{row.label}</span>
            <span className="text-sm text-right ml-4">{row.valueNode ?? row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
