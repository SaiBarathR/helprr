'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Download as DownloadIcon, Upload } from 'lucide-react';
import { ExportSettingsDialog } from '@/components/settings/export-settings-dialog';
import { ImportSettingsDialog } from '@/components/settings/import-settings-dialog';
import { GroupedSection } from '@/components/settings/grouped-section';

export default function BackupSettingsPage() {
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Backup & Restore</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Move your settings between devices or back them up to a file.
        </p>
      </div>

      <GroupedSection footer="Includes service connections, preferences, and device-local UI prefs">
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="grouped-row w-full text-left active:bg-foreground/5 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-yellow-500/10 text-yellow-400">
              <DownloadIcon className="h-[18px] w-[18px]" />
            </span>
            <div className="flex flex-col items-start min-w-0">
              <span className="text-[15px] font-medium truncate">Export settings</span>
              <span className="text-xs text-muted-foreground truncate">Save preferences and service config to JSON</span>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="grouped-row w-full text-left active:bg-foreground/5 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-md shrink-0 bg-sky-500/10 text-sky-400">
              <Upload className="h-[18px] w-[18px]" />
            </span>
            <div className="flex flex-col items-start min-w-0">
              <span className="text-[15px] font-medium truncate">Import settings</span>
              <span className="text-xs text-muted-foreground truncate">Restore from a previously exported file</span>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </GroupedSection>

      <ExportSettingsDialog open={exportOpen} onOpenChange={setExportOpen} />
      <ImportSettingsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          window.setTimeout(() => window.location.reload(), 600);
        }}
      />
    </div>
  );
}
