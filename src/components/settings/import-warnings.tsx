'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isImportFollowUp, type ImportWarning } from '@/lib/settings-import/follow-up-tasks';

const STORAGE_KEY = 'helprr:import-warnings';
const NOTICE_KEY = 'helprr:import-notice';
// The reload follows within a second. One left behind by leaving the page
// first must not show on a later visit to it.
const NOTICE_MAX_AGE_MS = 10_000;
const TITLE = 'Imported, but not all of it is in effect yet';

/** Re-run the steps behind these warnings; resolves with what is still not done. */
async function retryImportFollowUps(warnings: ImportWarning[]): Promise<ImportWarning[]> {
  const res = await fetch('/api/settings/import/follow-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: warnings.map((warning) => warning.task),
      alertIds: warnings.flatMap((warning) => warning.alertIds ?? []),
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || 'Retry failed');
  return Array.isArray(json?.warnings) ? json.warnings : [];
}

function WarningList({ warnings }: { warnings: ImportWarning[] }) {
  return (
    <ul className="list-disc space-y-1 pl-4">
      {warnings.map((warning) => <li key={warning.task}>{warning.message}</li>)}
    </ul>
  );
}

// For a dialog without an owner page: list them in a toast that stays until
// dismissed.
export function showImportWarnings(warnings: ImportWarning[]) {
  if (warnings.length === 0) return;
  toast.warning(TITLE, { description: <WarningList warnings={warnings} />, duration: Infinity });
}

/** The one-line result of an import ("Settings imported."), as a toast. */
export interface ImportNotice {
  type: 'success' | 'warning' | 'info';
  message: string;
}

export function showImportNotice(notice: ImportNotice) {
  toast[notice.type](notice.message);
}

/**
 * Keep the result's toast across the page reload that applies an import: the
 * reload follows it within a second and takes it away. Best effort; the
 * reload goes ahead without it.
 */
export function rememberImportNotice(notice: ImportNotice): void {
  try {
    sessionStorage.setItem(NOTICE_KEY, JSON.stringify({ ...notice, at: Date.now() }));
  } catch { }
}

function takeRememberedImportNotice(): ImportNotice | null {
  try {
    const raw = sessionStorage.getItem(NOTICE_KEY);
    sessionStorage.removeItem(NOTICE_KEY);
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (!stored || typeof stored !== 'object') return null;
    const { type, message, at } = stored as Partial<ImportNotice> & { at?: unknown };
    if ((type !== 'success' && type !== 'warning' && type !== 'info') || typeof message !== 'string') return null;
    if (typeof at !== 'number') return null;
    const age = Date.now() - at;
    if (age < 0 || age > NOTICE_MAX_AGE_MS) return null;
    return { type, message };
  } catch {
    return null;
  }
}

/**
 * Keep warnings across the page reload that applies an import. False when they
 * could not be kept, so the caller must show them without reloading.
 */
export function rememberImportWarnings(warnings: ImportWarning[]): boolean {
  if (warnings.length === 0) return true;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(warnings));
    return true;
  } catch {
    return false;
  }
}

function takeRememberedImportWarnings(): ImportWarning[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    const stored: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(stored)) return [];
    return stored.filter((warning): warning is ImportWarning =>
      Boolean(warning) && isImportFollowUp(warning.task) && typeof warning.message === 'string');
  } catch {
    return [];
  }
}

/**
 * The warnings an import left before the page reloaded. They are shown in the
 * page rather than as a toast: the page reads them while it hydrates, before
 * the toaster is listening. The result's one-line notice is shown as a toast
 * again, once the toaster listens.
 */
export function useImportWarnings(): [ImportWarning[], Dispatch<SetStateAction<ImportWarning[]>>] {
  const [warnings, setWarnings] = useState<ImportWarning[]>([]);
  // Read once: Strict Mode runs the effect twice, and the second read would
  // find the storage already emptied.
  const taken = useRef(false);

  useEffect(() => {
    if (taken.current) return;
    taken.current = true;
    setWarnings(takeRememberedImportWarnings());
    // Taken once, so a later reload doesn't show it again. Next task: the
    // root layout's toaster starts listening in this same commit, after the page.
    const notice = takeRememberedImportNotice();
    if (notice) window.setTimeout(() => showImportNotice(notice));
  }, []);

  return [warnings, setWarnings];
}

export function ImportWarningsNotice({
  warnings,
  onChange,
}: {
  warnings: ImportWarning[];
  onChange: (warnings: ImportWarning[]) => void;
}) {
  const [retrying, setRetrying] = useState(false);

  if (warnings.length === 0) return null;

  const retry = async () => {
    setRetrying(true);
    try {
      const remaining = await retryImportFollowUps(warnings);
      onChange(remaining);
      if (remaining.length === 0) toast.success('The whole import is in effect now.');
    } catch (err) {
      toast.error((err as Error).message || 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div role="alert" className="mx-4 mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-sm">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{TITLE}</p>
          <div className="text-muted-foreground"><WarningList warnings={warnings} /></div>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => onChange([])} disabled={retrying}>
          Dismiss
        </Button>
        <Button size="sm" onClick={retry} disabled={retrying}>
          {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Retry
        </Button>
      </div>
    </div>
  );
}
