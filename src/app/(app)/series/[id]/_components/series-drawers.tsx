'use client';

import { Button } from '@/components/ui/button';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
  DrawerDescription, DrawerFooter, DrawerClose,
} from '@/components/ui/drawer';
import { Loader2 } from 'lucide-react';
import { MONITOR_OPTIONS } from './format';
import type { SeriesActions } from './use-series-actions';

/** Choose which episodes Sonarr monitors, then Apply. */
export function SeriesMonitorDrawer({ title, actions }: { title: string; actions: SeriesActions }) {
  const { showMonitorEdit, setShowMonitorEdit, monitorOption, setMonitorOption, actionLoading } = actions;
  return (
    <Drawer open={showMonitorEdit} onOpenChange={setShowMonitorEdit}>
      <DrawerContent>
        <DrawerHeader className="text-center">
          <DrawerTitle>Monitor</DrawerTitle>
          <DrawerDescription>
            Choose which episodes to monitor for {title}.
          </DrawerDescription>
        </DrawerHeader>
        {/* The options scroll so Apply and Cancel stay on a short phone's screen. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          <div className="grouped-section">
            <div className="grouped-section-content">
              {MONITOR_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setMonitorOption(option.value)}
                  className={`grouped-row w-full text-left active:bg-foreground/5 transition-colors ${monitorOption === option.value ? 'text-primary' : ''
                    }`}
                >
                  <span className="text-sm">{option.label}</span>
                  {monitorOption === option.value && (
                    <span className="text-primary text-sm font-medium">&#10003;</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DrawerFooter>
          <Button
            onClick={actions.applyMonitor}
            disabled={!monitorOption || actionLoading === 'applyMonitor'}
            className="w-full"
          >
            {actionLoading === 'applyMonitor' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/** Delete the series from Sonarr, and its files only when asked. */
export function SeriesDeleteDrawer({
  title,
  open,
  onOpenChange,
  actions,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: SeriesActions;
}) {
  const { deleteFiles, setDeleteFiles, deleting } = actions;
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        // Opt in to deleting files each time, as the shared delete dialog does.
        if (!next) setDeleteFiles(false);
        onOpenChange(next);
      }}
    >
      <DrawerContent>
        <DrawerHeader className="text-center">
          <DrawerTitle>Delete {title}?</DrawerTitle>
          <DrawerDescription>
            This removes the series from Sonarr. Optionally delete the files on disk too. This action cannot be undone.
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              disabled={deleting}
              className="h-4 w-4 accent-destructive"
            />
            Also delete all files from disk
          </label>
        </div>
        <DrawerFooter>
          <Button variant="destructive" onClick={actions.deleteSeries} disabled={deleting} className="w-full">
            {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete Series
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
