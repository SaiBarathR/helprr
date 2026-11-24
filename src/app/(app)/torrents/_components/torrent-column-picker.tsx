'use client';

import { Columns3 } from 'lucide-react';
import {
  ResponsiveMenu,
  ResponsiveMenuActionItem,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuSeparator,
} from '@/components/ui/responsive-menu';
import { DEFAULT_TORRENTS_TABLE_COLUMNS, TORRENTS_TABLE_COLUMNS, type TorrentsTableColumn } from '@/lib/store';
import { TORRENT_TABLE_COLUMN_LABELS } from './use-torrent-table';

/** The torrents table's column picker: show or hide any column but Name. */
export function TorrentColumnPicker({
  columns,
  onChange,
}: {
  columns: readonly TorrentsTableColumn[];
  onChange: (columns: TorrentsTableColumn[]) => void;
}) {
  // Kept in table order, so the stored list reads like the table.
  const toggle = (column: TorrentsTableColumn) => onChange(
    TORRENTS_TABLE_COLUMNS.filter((id) => (id === column ? !columns.includes(id) : columns.includes(id))),
  );

  return (
    <ResponsiveMenu
      title="Columns"
      titleInDropdown
      align="end"
      contentClassName="w-56 max-h-[min(36rem,75vh)] overflow-y-auto"
      trigger={(
        <button
          className="relative touch-target -my-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Columns"
        >
          <Columns3 className="h-4 w-4" />
          Columns
        </button>
      )}
    >
      {TORRENTS_TABLE_COLUMNS.map((column) => (
        <ResponsiveMenuCheckboxItem
          key={column}
          checked={columns.includes(column)}
          onCheckedChange={() => toggle(column)}
        >
          {TORRENT_TABLE_COLUMN_LABELS[column]}
        </ResponsiveMenuCheckboxItem>
      ))}
      <ResponsiveMenuSeparator />
      <ResponsiveMenuActionItem onSelect={() => onChange([...DEFAULT_TORRENTS_TABLE_COLUMNS])}>
        Default columns
      </ResponsiveMenuActionItem>
    </ResponsiveMenu>
  );
}
