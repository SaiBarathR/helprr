'use client';

import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface DataTableColumn<T> {
  id: string;
  label: ReactNode;
  /** Default width in px. The `grow` column treats it as a minimum and absorbs leftover space. */
  width: number;
  /** Resize floor in px. */
  minWidth?: number;
  align?: 'left' | 'right' | 'center';
  /** When set (and onSort is provided), the header becomes a sort toggle for this key. */
  sortKey?: string;
  /** Absorbs leftover container width (exactly one column should set this). */
  grow?: boolean;
  /** Disable the drag-resize handle (checkbox / action columns). */
  fixed?: boolean;
  headerClassName?: string;
  cellClassName?: string;
  cell: (row: T) => ReactNode;
}

export const DATA_TABLE_PAGE_SIZES = [25, 50, 100, 250] as const;
const DEFAULT_PAGE_SIZE = 50;
const RESIZE_MIN_WIDTH = 48;

interface StoredTablePrefs {
  widths?: Record<string, number>;
  pageSize?: number;
}

function prefsKey(tableId: string) {
  return `helprr-table:${tableId}`;
}

function readStoredPrefs(tableId: string): StoredTablePrefs {
  try {
    const raw = localStorage.getItem(prefsKey(tableId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredTablePrefs;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredPrefs(tableId: string, update: StoredTablePrefs) {
  try {
    localStorage.setItem(prefsKey(tableId), JSON.stringify({ ...readStoredPrefs(tableId), ...update }));
  } catch {
    // best-effort — prefs just don't persist
  }
}

export interface DataTableProps<T> {
  /** Stable id used to persist column widths + page size in localStorage. */
  tableId: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  /** Wrap a rendered <tr> (e.g. in a QuickContextMenu). Must render the element it receives. */
  wrapRow?: (row: T, element: ReactElement) => ReactNode;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Client-side pagination (default on). */
  paginate?: boolean;
  defaultPageSize?: number;
  /** Reset to page 1 whenever this value changes (search / filter changes). */
  resetPageKey?: unknown;
  emptyMessage?: ReactNode;
}

/**
 * Shared table shell: fixed-layout columns with drag-to-resize handles
 * (double-click resets), horizontal scroll instead of hiding columns,
 * sortable headers, and client-side pagination. Widths and page size persist
 * per `tableId` in localStorage.
 */
export function DataTable<T>({
  tableId,
  columns,
  rows,
  rowKey,
  sortKey,
  sortDir = 'desc',
  onSort,
  wrapRow,
  onRowClick,
  rowClassName,
  paginate = true,
  defaultPageSize = DEFAULT_PAGE_SIZE,
  resetPageKey,
  emptyMessage,
}: DataTableProps<T>) {
  // Lazy initializers read the persisted prefs; the SSR guard keeps them inert
  // on the server (in practice the table only mounts client-side, after the
  // page's data query resolves, so there is no hydration-mismatch window).
  const [widthOverrides, setWidthOverrides] = useState<Record<string, number>>(() =>
    typeof window === 'undefined' ? {} : readStoredPrefs(tableId).widths ?? {},
  );
  const [pageSize, setPageSize] = useState(() => {
    if (typeof window === 'undefined') return defaultPageSize;
    const stored = readStoredPrefs(tableId).pageSize;
    return stored && (DATA_TABLE_PAGE_SIZES as readonly number[]).includes(stored)
      ? stored
      : defaultPageSize;
  });
  const [page, setPage] = useState(1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Live drag state kept in a ref; only the resulting width goes through setState.
  const dragRef = useRef<{ columnId: string; startX: number; startWidth: number } | null>(null);

  const widthOf = useCallback(
    (col: DataTableColumn<T>) => Math.max(col.minWidth ?? RESIZE_MIN_WIDTH, widthOverrides[col.id] ?? col.width),
    [widthOverrides],
  );

  // min-width = sum of column widths, so narrow containers scroll horizontally
  // instead of crushing (or hiding) columns.
  const totalWidth = useMemo(
    () => columns.reduce((sum, col) => sum + widthOf(col), 0),
    [columns, widthOf],
  );

  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLSpanElement>, col: DataTableColumn<T>) => {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = widthOf(col);
    dragRef.current = { columnId: col.id, startX: e.clientX, startWidth };
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = Math.round(Math.max(col.minWidth ?? RESIZE_MIN_WIDTH, drag.startWidth + (ev.clientX - drag.startX)));
      setWidthOverrides((prev) => (prev[drag.columnId] === next ? prev : { ...prev, [drag.columnId]: next }));
    };
    const onUp = () => {
      dragRef.current = null;
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      // Read the committed value out of state via the updater so we persist
      // exactly what the last move landed on.
      setWidthOverrides((prev) => {
        writeStoredPrefs(tableId, { widths: prev });
        return prev;
      });
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, [tableId, widthOf]);

  const handleResizeReset = useCallback((col: DataTableColumn<T>) => {
    setWidthOverrides((prev) => {
      if (!(col.id in prev)) return prev;
      const next = { ...prev };
      delete next[col.id];
      writeStoredPrefs(tableId, { widths: next });
      return next;
    });
  }, [tableId]);

  // Pagination derives from clamped page so shrinking row sets can't strand
  // the view on an empty page.
  const pageCount = paginate ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => (paginate ? rows.slice((currentPage - 1) * pageSize, currentPage * pageSize) : rows),
    [rows, paginate, currentPage, pageSize],
  );

  // Filters/search changed → the old page offset is meaningless. Render-time
  // state adjustment (not an effect) so the reset lands in the same pass.
  const [prevResetKey, setPrevResetKey] = useState(resetPageKey);
  if (prevResetKey !== resetPageKey) {
    setPrevResetKey(resetPageKey);
    setPage(1);
  }

  const goToPage = useCallback((next: number) => {
    setPage(next);
    // Jump back to the top of the table (offset for sticky toolbars).
    containerRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, []);

  const changePageSize = useCallback((value: string) => {
    const size = Number(value);
    if (!Number.isFinite(size) || size <= 0) return;
    setPageSize(size);
    setPage(1);
    writeStoredPrefs(tableId, { pageSize: size });
  }, [tableId]);

  const alignClass = (align?: 'left' | 'right' | 'center') =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  const rangeStart = rows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(rows.length, currentPage * pageSize);

  return (
    <div
      ref={containerRef}
      className="rounded-xl bg-card overflow-hidden"
      style={{ scrollMarginTop: 'calc(var(--header-height, 0px) + 7rem)' }}
    >
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-sm table-fixed" style={{ minWidth: totalWidth }}>
          <colgroup>
            {columns.map((col) => (
              <col key={col.id} style={col.grow && !(col.id in widthOverrides) ? { minWidth: widthOf(col) } : { width: widthOf(col) }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-border/50 text-xs text-muted-foreground">
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={cn('relative px-3 py-2 font-medium select-none', alignClass(col.align), col.headerClassName)}
                >
                  {col.sortKey && onSort ? (
                    <button
                      type="button"
                      className={cn(
                        'inline-flex max-w-full items-center gap-0.5 font-medium transition-colors hover:text-foreground',
                        col.align === 'right' && 'flex-row-reverse',
                        sortKey === col.sortKey && 'text-foreground',
                      )}
                      onClick={() => onSort(col.sortKey!)}
                    >
                      <span className="truncate">{col.label}</span>
                      {sortKey === col.sortKey && (
                        sortDir === 'asc'
                          ? <ArrowUp className="h-3 w-3 shrink-0" />
                          : <ArrowDown className="h-3 w-3 shrink-0" />
                      )}
                    </button>
                  ) : typeof col.label === 'string' ? (
                    <span className="block truncate">{col.label}</span>
                  ) : (
                    // Node labels (e.g. a select-all checkbox) must not sit in
                    // a truncate wrapper — its overflow:hidden clips them in
                    // narrow fixed columns.
                    col.label
                  )}
                  {!col.fixed && (
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize column`}
                      className="group/resize absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize items-center justify-center"
                      style={{ touchAction: 'none' }}
                      onPointerDown={(e) => handleResizeStart(e, col)}
                      onDoubleClick={() => handleResizeReset(col)}
                    >
                      <span className="h-4 w-px bg-border transition-colors group-hover/resize:h-full group-hover/resize:w-0.5 group-hover/resize:bg-primary" />
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                  {emptyMessage ?? 'No results.'}
                </td>
              </tr>
            )}
            {pageRows.map((row) => {
              const tr = (
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'transition-colors hover:bg-muted/30',
                    onRowClick && 'cursor-pointer',
                    rowClassName?.(row),
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn('px-3 py-2', alignClass(col.align), col.cellClassName)}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              );
              return (
                <Fragment key={rowKey(row)}>
                  {wrapRow ? wrapRow(row, tr) : tr}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {paginate && rows.length > DATA_TABLE_PAGE_SIZES[0] && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-3 py-1.5">
          <span className="text-xs text-muted-foreground tabular-nums">
            {rangeStart}&ndash;{rangeEnd} of {rows.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Select value={String(pageSize)} onValueChange={changePageSize}>
              <SelectTrigger size="sm" className="h-8 gap-1 border-none bg-transparent px-2 text-xs text-muted-foreground shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {DATA_TABLE_PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>{size} / page</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              className="flex h-8 min-w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-1 text-xs text-muted-foreground tabular-nums">
              {currentPage} / {pageCount}
            </span>
            <button
              type="button"
              className="flex h-8 min-w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
