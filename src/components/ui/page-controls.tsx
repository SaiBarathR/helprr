'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PageControlsProps {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  loading?: boolean;
}

/**
 * Prev / page-number / Next controls. Extracted verbatim from the cleanup
 * history tab so paginated tables (cleanup history, cleanup strikes, …) share
 * one control. `total`/`pageSize` derive the page count internally.
 */
export function PageControls({ page, total, pageSize, onPage, loading = false }: PageControlsProps) {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="w-4 h-4 mr-1" /> Prev
      </Button>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground">Page</Label>
        <Input
          type="number"
          min={1}
          max={totalPages}
          value={page}
          onChange={(e) => {
            const next = Math.max(1, Math.min(totalPages, Number(e.target.value) || 1));
            onPage(next);
          }}
          className="w-16 h-8"
        />
        <span className="text-xs text-muted-foreground">/ {totalPages}</span>
      </div>
      <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>
        Next <ChevronRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );
}
