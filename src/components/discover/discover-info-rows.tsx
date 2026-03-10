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
    <div>
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      <div>
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex justify-between items-start py-2.5 border-b border-border/40 last:border-b-0"
          >
            <span className="text-sm text-muted-foreground shrink-0">{row.label}</span>
            <span className="text-sm text-right ml-4 truncate max-w-[60%]">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
