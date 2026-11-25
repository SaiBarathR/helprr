'use client';

import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { PageHeader } from '@/components/layout/page-header';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useMe } from '@/components/permission-provider';
import type { ArrCategoryUse } from '@/lib/qbittorrent-category-usage';
import { defaultCategoryFolder } from './category-links';
import { FolderPickerButton } from './folder-picker';
import { sendCategoryChange, useCategoryDetails } from './use-categories';
import { useQbitInstance } from './use-qbit-instance';

type ArrWarning = { uses: ArrCategoryUse[]; unchecked: string[] };
/** A refused save, shown under the field it is about (or above the buttons). */
type SaveError = { message: string; field?: 'name' | 'savePath' };

function FieldError({ id, error }: { id: string; error: string | undefined }) {
  if (!error) return null;
  return <p id={id} role="alert" className="mb-1 text-destructive">{error}</p>;
}

/** What saving a new folder does to the category's torrents, as qBittorrent is set. */
function relocationNote(relocate: boolean | null): string {
  if (relocate === true) {
    return 'Saving a new folder moves its torrents under automatic management there. Torrents under manual management stay where they are.';
  }
  if (relocate === false) {
    return "Saving a new folder doesn't move its torrents: qBittorrent switches those under automatic management to manual management, and they stay where they are. To move them instead, set qBittorrent's \"When Category Save Path changed\" to Relocate.";
  }
  return 'Saving a new folder moves its torrents under automatic management there, unless qBittorrent is set to switch them to manual management.';
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  const { subtitle } = useQbitInstance();
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} className="*:readable-column" backHref="/torrents/categories" />
      {children}
    </>
  );
}

/** New category (no `editName`), or one category's save path and removal. Admins only; the API enforces it. */
export function CategoryForm({ editName }: { editName?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isAdmin = useMe()?.role === 'admin';
  const detailsQuery = useCategoryDetails();
  const { instanceId, subtitle } = useQbitInstance();
  const details = detailsQuery.data;
  const editing = editName !== undefined;
  const existing = editing && details && Object.hasOwn(details.categories, editName) ? details.categories[editName] : null;
  const title = editing ? 'Edit Category' : 'New Category';

  const [name, setName] = useState('');
  const [savePath, setSavePath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [arrWarning, setArrWarning] = useState<ArrWarning | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  // Typing in a field clears its own error (and one about neither), not the other field's.
  const clearError = (field: 'name' | 'savePath') =>
    setSaveError((prev) => (prev && (!prev.field || prev.field === field) ? null : prev));

  // Seed once: a background refetch must not overwrite what is being typed.
  if (existing && savePath === null) setSavePath(existing.savePath);

  if (!isAdmin) {
    return (
      <Message title={title}>
        <p className="py-16 text-center text-sm text-muted-foreground">Only an admin can change categories.</p>
      </Message>
    );
  }
  if (detailsQuery.isLoading) return <Message title={title}><PageSpinner /></Message>;
  if (!details) {
    return (
      <Message title={title}>
        <ErrorState
          message="Failed to load qBittorrent's categories."
          onRetry={() => void detailsQuery.refetch()}
          retrying={detailsQuery.isFetching}
        />
      </Message>
    );
  }
  if (editing && !existing) {
    return (
      <Message title={title}>
        <p className="py-16 text-center text-sm text-muted-foreground">This category is no longer in qBittorrent.</p>
      </Message>
    );
  }

  const categoryName = editing ? editName : name.trim();
  const path = (savePath ?? '').trim();
  const root = details.defaultSavePath.replace(/[\\/]+$/, '');
  const implicitFolder = root ? defaultCategoryFolder(categoryName || 'name', details) : null;
  const canSave = !saving && !removing && (editing ? path !== (existing?.savePath ?? '') : categoryName !== '');
  const nameError = saveError?.field === 'name' ? saveError.message : undefined;
  const pathError = saveError?.field === 'savePath' ? saveError.message : undefined;
  const formError = saveError && !saveError.field ? saveError.message : undefined;
  // In subcategory mode qBittorrent removes "a/…" with "a".
  const subcategories = editing && details.subcategories
    ? Object.keys(details.categories).filter((key) => key.startsWith(`${editName}/`)).sort()
    : [];

  // Not awaited: the page goes back at once, and a removed category's refetch would flash "no longer in qBittorrent".
  const done = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: ['qbittorrent', 'categories'] });
    toast.success(message);
    router.back();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    const result = await sendCategoryChange(editing ? 'PATCH' : 'POST', { name: categoryName, savePath: path }, instanceId);
    setSaving(false);
    if (!result.ok) {
      setSaveError({ message: result.error, field: result.field });
      return;
    }
    done(editing ? 'Category saved' : `Created ${categoryName}`);
  };

  const remove = async () => {
    setRemoving(true);
    const result = await sendCategoryChange('DELETE', { categories: [editName], confirm: arrWarning !== null }, instanceId);
    setRemoving(false);
    if (!result.ok) {
      // The first refusal for an arr's category turns this dialog into the warning; its button then confirms.
      if (result.needsConfirm && !arrWarning) {
        setArrWarning({ uses: result.uses ?? [], unchecked: result.unchecked ?? [] });
        return;
      }
      setConfirmRemove(false);
      toast.error(result.error);
      return;
    }
    setConfirmRemove(false);
    done(`Removed ${editName}`);
  };

  return (
    <div className="animate-content-in">
      <PageHeader title={title} subtitle={subtitle} className="*:readable-column" backHref="/torrents/categories" />

      <form className="mt-3 pb-8 readable-column" onSubmit={handleSubmit}>
        <GroupedSection
          title="Name"
          footer={(nameError || editing || details.subcategories) && (
            <>
              <FieldError id="category-name-error" error={nameError} />
              {editing
                ? "qBittorrent can't rename a category."
                : details.subcategories ? 'A "/" makes a subcategory, like tv/anime.' : null}
            </>
          )}
        >
          <div className="grouped-row">
            {editing ? (
              <span className="text-sm break-all">{editName}</span>
            ) : (
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError('name');
                }}
                placeholder="Category name"
                aria-label="Category name"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? 'category-name-error' : undefined}
                maxLength={100}
                disabled={saving}
                autoCapitalize="none"
                autoCorrect="off"
                autoFocus
              />
            )}
          </div>
        </GroupedSection>

        <GroupedSection
          title="Save Path"
          footer={
            <>
              <FieldError id="category-path-error" error={pathError} />
              {implicitFolder
                ? `Leave it empty for qBittorrent's default folder (${implicitFolder}). A folder of its own must be inside ${root}.`
                : "Leave it empty for qBittorrent's default folder."}
              {editing && (
                <span className="block mt-1">{relocationNote(details.relocateOnCategoryPathChange)}</span>
              )}
            </>
          }
        >
          <div className="grouped-row gap-2">
            <Input
              value={savePath ?? ''}
              onChange={(e) => {
                setSavePath(e.target.value);
                clearError('savePath');
              }}
              placeholder={implicitFolder ?? 'Default folder'}
              aria-label="Save path"
              aria-invalid={pathError ? true : undefined}
              aria-describedby={pathError ? 'category-path-error' : undefined}
              disabled={saving || removing}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <FolderPickerButton
              purpose="category"
              value={savePath ?? ''}
              onPick={(picked) => {
                setSavePath(picked);
                clearError('savePath');
              }}
              disabled={saving || removing}
            />
          </div>
        </GroupedSection>

        {formError && <p role="alert" className="mb-3 px-4 text-xs text-destructive">{formError}</p>}
        <div className="flex gap-3">
          <Button type="submit" className="flex-1 h-11" disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? 'Save' : 'Create'}
          </Button>
          <Button type="button" variant="outline" className="flex-1 h-11" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
        </div>

        {editing && (
          <Button
            type="button"
            variant="outline"
            className="mt-6 w-full h-11 text-destructive hover:text-destructive"
            onClick={() => { setArrWarning(null); setConfirmRemove(true); }}
            disabled={saving || removing}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remove Category
          </Button>
        )}
      </form>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={(open) => { if (!open && !removing) setConfirmRemove(false); }}
        title={arrWarning ? `${editName} may be in use` : `Remove ${editName}?`}
        description={
          <>
            {arrWarning && (
              <>
                {arrWarning.uses.map((use) => (
                  <span key={`${use.instance}|${use.downloadClient}|${use.category}`} className="block">
                    {use.instance === use.app ? use.app : `${use.app} (${use.instance})`} uses {use.category} in its download client {use.downloadClient}.
                  </span>
                ))}
                {arrWarning.unchecked.length > 0 && (
                  <span className="block">Did not answer, so not checked: {arrWarning.unchecked.join(', ')}.</span>
                )}
                <span className="block mt-2 mb-2">
                  Removing it stops their imports until their download client gets another category.
                </span>
              </>
            )}
            <span className="block">Torrents in it lose the category. Their files stay where they are.</span>
            {subcategories.length > 0 && (
              <span className="block mt-2">Its subcategories go too: {subcategories.join(', ')}.</span>
            )}
          </>
        }
        confirmLabel={arrWarning ? 'Remove Anyway' : 'Remove'}
        destructive
        busy={removing}
        onConfirm={remove}
      />
    </div>
  );
}
