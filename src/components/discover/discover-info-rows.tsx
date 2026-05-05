'use client';

interface InfoRow {
  label: string;
  value: string;
}

interface DiscoverInfoRowsProps {
  title: string;
  rows: InfoRow[];
}

export function DiscoverInfoRows({ title, rows }: DiscoverInfoRowsProps) {
  if (!rows.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="reel" aria-hidden />
        <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
          {title}
        </h2>
        <span className="hairline flex-1" aria-hidden />
      </div>
      <div className="border-t border-b border-[color:var(--hairline)]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex justify-between items-baseline gap-3 py-2.5 border-b border-[color:var(--hairline)] last:border-b-0"
          >
            <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>
              {row.label}
            </span>
            <span className="text-[13px] font-mono tabular text-right truncate max-w-[60%]">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
