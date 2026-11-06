'use client';

import { useState, type ReactNode } from 'react';
import { FileEdit, Loader2 } from 'lucide-react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { useMetadataProfiles, useQualityProfiles, useRootFolders } from '@/lib/hooks/use-reference-data';
import type { BulkEditService } from '@/lib/bulk-editor';

/** Settings a bulk edit can change; an absent field is left as it is on every item. */
export interface BulkEditChanges {
  qualityProfileId?: number;
  rootFolderPath?: string;
  moveFiles?: boolean;
  seriesType?: 'standard' | 'daily' | 'anime';
  seasonFolder?: boolean;
  monitorNewItems?: 'all' | 'none';
  minimumAvailability?: 'announced' | 'inCinemas' | 'released';
  metadataProfileId?: number;
}

export interface BulkEditSheetOptions {
  service: BulkEditService;
  /** The one instance every selected item is on (undefined = default); null when they span instances. */
  instanceId: string | undefined | null;
  /** Quality profile, series type, folders, availability, metadata profile and monitor-new are admin-only. */
  isAdmin: boolean;
  canChangePath: boolean;
  /** Organize (rename files) runs as an *arr command, gated like the other commands. */
  canOrganize: boolean;
  /**
   * Resolve true when every instance succeeded (the sheet closes). On false the sheet stays
   * open with its picks, and the page has narrowed the selection to the failed instances.
   */
  onApply: (changes: BulkEditChanges) => Promise<boolean>;
  onOrganize: () => Promise<boolean>;
}

interface BulkEditSheetProps extends Omit<BulkEditSheetOptions, 'onApply' | 'onOrganize'> {
  onApply: (changes: BulkEditChanges) => Promise<void>;
  onOrganize: () => Promise<void>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  /** Noun for the selection, already pluralized for count, e.g. "series", "movies". */
  plural: string;
  busy: boolean;
}

/** Whether the sheet has anything to offer this user. */
export function bulkEditSheetAvailable(o: Pick<BulkEditSheetOptions, 'isAdmin' | 'canChangePath' | 'canOrganize'>) {
  return o.isAdmin || o.canChangePath || o.canOrganize;
}

// Radix Select can't hold an empty value, so "leave as is" is a sentinel.
const KEEP = 'keep';

const SERVICE_NAME: Record<BulkEditService, string> = { sonarr: 'Sonarr', radarr: 'Radarr', lidarr: 'Lidarr' };

function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grouped-row gap-3">
      <Label htmlFor={id} className="text-sm shrink-0">{label}</Label>
      {children}
    </div>
  );
}

function ChoiceSelect({
  id,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-[180px] min-w-0 border-0 bg-transparent text-right">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={KEEP}>No change</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The form. Mounted only while the sheet is open, so the reference data it needs is
 * fetched on demand and every open starts from "No change".
 */
function BulkEditForm({
  service,
  instanceId,
  isAdmin,
  canChangePath,
  canOrganize,
  onApply,
  onOrganize,
  count,
  plural,
  busy,
}: Omit<BulkEditSheetProps, 'open' | 'onOpenChange'>) {
  // Profile ids and root folders differ between instances, so those pickers need a
  // selection on one instance; the fixed-choice fields work across instances.
  const oneInstance = instanceId !== null;
  const instance = instanceId ?? undefined;
  const { data: qualityProfiles = [] } = useQualityProfiles(service, instance, isAdmin && oneInstance);
  const { data: metadataProfiles = [] } = useMetadataProfiles(instance, service === 'lidarr' && isAdmin && oneInstance);
  const { data: rootFolders = [] } = useRootFolders(service, instance, canChangePath && oneInstance);

  const [qualityProfile, setQualityProfile] = useState(KEEP);
  const [metadataProfile, setMetadataProfile] = useState(KEEP);
  const [rootFolder, setRootFolder] = useState(KEEP);
  const [moveFiles, setMoveFiles] = useState(false);
  const [seriesType, setSeriesType] = useState(KEEP);
  const [seasonFolder, setSeasonFolder] = useState(KEEP);
  const [monitorNewItems, setMonitorNewItems] = useState(KEEP);
  const [minimumAvailability, setMinimumAvailability] = useState(KEEP);
  const [confirm, setConfirm] = useState<'move' | 'organize' | null>(null);

  const changes: BulkEditChanges = {};
  if (qualityProfile !== KEEP) changes.qualityProfileId = Number(qualityProfile);
  if (metadataProfile !== KEEP) changes.metadataProfileId = Number(metadataProfile);
  if (rootFolder !== KEEP) {
    changes.rootFolderPath = rootFolder;
    changes.moveFiles = moveFiles;
  }
  if (seriesType !== KEEP) changes.seriesType = seriesType as BulkEditChanges['seriesType'];
  if (seasonFolder !== KEEP) changes.seasonFolder = seasonFolder === 'on';
  if (monitorNewItems !== KEEP) changes.monitorNewItems = monitorNewItems as BulkEditChanges['monitorNewItems'];
  if (minimumAvailability !== KEEP) {
    changes.minimumAvailability = minimumAvailability as BulkEditChanges['minimumAvailability'];
  }
  const hasChanges = Object.keys(changes).length > 0;
  const moving = changes.rootFolderPath !== undefined && moveFiles;
  const newNoun = service === 'sonarr' ? 'seasons' : 'albums';

  function apply() {
    // Moving files is a disk operation on every selected item: confirm it first.
    if (moving) setConfirm('move');
    else void onApply(changes);
  }

  return (
    <>
      <div className="space-y-5">
        {isAdmin && (
          <div className="grouped-section">
            <p className="grouped-section-title">Profiles</p>
            <div className="grouped-section-content">
              <Row id="bulk-quality-profile" label="Quality Profile">
                <ChoiceSelect
                  id="bulk-quality-profile"
                  value={qualityProfile}
                  onChange={setQualityProfile}
                  disabled={!oneInstance}
                  options={qualityProfiles.map((p) => ({ value: String(p.id), label: p.name }))}
                />
              </Row>
              {service === 'lidarr' && (
                <Row id="bulk-metadata-profile" label="Metadata Profile">
                  <ChoiceSelect
                    id="bulk-metadata-profile"
                    value={metadataProfile}
                    onChange={setMetadataProfile}
                    disabled={!oneInstance}
                    options={metadataProfiles.map((p) => ({ value: String(p.id), label: p.name }))}
                  />
                </Row>
              )}
              {service === 'sonarr' && (
                <Row id="bulk-series-type" label="Series Type">
                  <ChoiceSelect
                    id="bulk-series-type"
                    value={seriesType}
                    onChange={setSeriesType}
                    options={[
                      { value: 'standard', label: 'Standard' },
                      { value: 'daily', label: 'Daily' },
                      { value: 'anime', label: 'Anime' },
                    ]}
                  />
                </Row>
              )}
              {service === 'radarr' && (
                <Row id="bulk-minimum-availability" label="Minimum Availability">
                  <ChoiceSelect
                    id="bulk-minimum-availability"
                    value={minimumAvailability}
                    onChange={setMinimumAvailability}
                    options={[
                      { value: 'announced', label: 'Announced' },
                      { value: 'inCinemas', label: 'In Cinemas' },
                      { value: 'released', label: 'Released' },
                    ]}
                  />
                </Row>
              )}
              {service !== 'radarr' && (
                <Row id="bulk-monitor-new" label={`Monitor New ${service === 'sonarr' ? 'Seasons' : 'Albums'}`}>
                  <ChoiceSelect
                    id="bulk-monitor-new"
                    value={monitorNewItems}
                    onChange={setMonitorNewItems}
                    options={[
                      { value: 'all', label: `All new ${newNoun}` },
                      { value: 'none', label: 'None' },
                    ]}
                  />
                </Row>
              )}
              {service === 'sonarr' && (
                <Row id="bulk-season-folder" label="Season Folder">
                  <ChoiceSelect
                    id="bulk-season-folder"
                    value={seasonFolder}
                    onChange={setSeasonFolder}
                    options={[
                      { value: 'on', label: 'Use season folders' },
                      { value: 'off', label: 'No season folders' },
                    ]}
                  />
                </Row>
              )}
            </div>
          </div>
        )}

        {canChangePath && (
          <div className="grouped-section">
            <p className="grouped-section-title">Root Folder</p>
            <div className="grouped-section-content">
              <Row id="bulk-root-folder" label="Root Folder">
                <ChoiceSelect
                  id="bulk-root-folder"
                  value={rootFolder}
                  onChange={setRootFolder}
                  disabled={!oneInstance}
                  options={rootFolders.map((f) => ({ value: f.path, label: f.path }))}
                />
              </Row>
              {rootFolder !== KEEP && (
                <Row id="bulk-move-files" label="Move Files">
                  <Switch id="bulk-move-files" checked={moveFiles} onCheckedChange={setMoveFiles} />
                </Row>
              )}
            </div>
            {rootFolder !== KEEP && (
              <p className="px-4 pt-2 text-xs text-muted-foreground">
                {moveFiles
                  ? `${SERVICE_NAME[service]} moves the files of each selected item into this folder.`
                  : 'Only the saved path changes; files stay where they are until you move them.'}
              </p>
            )}
          </div>
        )}

        {!oneInstance && (isAdmin || canChangePath) && (
          <p className="px-1 text-xs text-muted-foreground">
            The selection spans instances. Select items from one instance to change profiles or the root folder.
          </p>
        )}

        {(isAdmin || canChangePath) && (
          <Button className="w-full" disabled={!hasChanges || busy} onClick={apply}>
            {busy && confirm === null && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply to {count} {plural}
          </Button>
        )}

        {canOrganize && (
          <div className="grouped-section">
            <p className="grouped-section-title">Files</p>
            <div className="grouped-section-content">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirm('organize')}
                className="grouped-row w-full gap-3 text-left text-sm hover:bg-accent disabled:opacity-50"
              >
                <FileEdit className="h-4 w-4 shrink-0" />
                <span className="flex-1">Organize files</span>
              </button>
            </div>
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              Renames files to match the naming format set in {SERVICE_NAME[service]}.
            </p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'move'}
        onOpenChange={(open) => { if (!open && !busy) setConfirm(null); }}
        title={`Move files for ${count} ${plural}?`}
        description={`${SERVICE_NAME[service]} will move the files of ${count} ${plural} into ${changes.rootFolderPath ?? ''}. Files move on disk, which can take a while for a large library.`}
        confirmLabel="Move files"
        destructive
        busy={busy}
        onConfirm={async () => {
          await onApply(changes);
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === 'organize'}
        onOpenChange={(open) => { if (!open && !busy) setConfirm(null); }}
        title={`Organize ${count} ${plural}?`}
        description={`${SERVICE_NAME[service]} renames the files of ${count} ${plural} to match its naming format. Use Preview rename on a single title to see the changes first.`}
        confirmLabel="Organize"
        busy={busy}
        onConfirm={async () => {
          await onOrganize();
          setConfirm(null);
        }}
      />
    </>
  );
}

/** "More" bulk actions: a bottom sheet on phones, a dialog on wider screens. */
export function BulkEditSheet({ open, onOpenChange, count, plural, ...rest }: BulkEditSheetProps) {
  const compact = useCompactViewport();
  const title = `Edit ${count} ${plural}`;
  const description = 'Fields left at “No change” stay as they are on every item.';
  const form = <BulkEditForm count={count} plural={plural} {...rest} />;

  if (compact) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="data-[vaul-drawer-direction=bottom]:h-auto">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">{form}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}
