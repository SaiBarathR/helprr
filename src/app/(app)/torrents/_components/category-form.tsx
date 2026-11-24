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
import { sendCategoryChange, useCategoryDetails } from './use-categories';

type ArrWarning = { uses: ArrCategoryUse[]; unchecked: string[] };

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <PageHeader title={title} className="*:readable-column" backHref="/torrents/categories" />
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
  const canSave = !saving && !removing && (editing ? path !== (existing?.savePath ?? '') : categoryName !== '');
  // In subcategory mode qBittorrent removes "a/…" with "a".
  const subcategories = editing && details.subcategories
    ? Object.keys(details.categories).filter((key) => key.startsWith(`${editName}/`)).sort()
    : [];

  const done = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: ['qbittorrent', 'categories'] });
    toast.success(message);
    router.back();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    const result = await sendCategoryChange(editing ? 'PATCH' : 'POST', { name: categoryName, savePath: path });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await done(editing ? 'Category saved' : `Created ${categoryName}`);
  };

  const remove = async () => {
    setRemoving(true);
    const result = await sendCategoryChange('DELETE', { categories: [editName], confirm: arrWarning !== null });
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
    await done(`Removed ${editName}`);
  };

  return (
    <div className="animate-content-in">
      <PageHeader title={title} className="*:readable-column" backHref="/torrents/categories" />

      <form className="mt-3 pb-8 readable-column" onSubmit={handleSubmit}>
        <GroupedSection
          title="Name"
          footer={editing
            ? "qBittorrent can't rename a category."
            : details.subcategories ? 'A "/" makes a subcategory, like tv/anime.' : undefined}
        >
          <div className="grouped-row">
            {editing ? (
              <span className="text-sm break-all">{editName}</span>
            ) : (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Category name"
                aria-label="Category name"
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
          footer={root
            ? `Leave it empty for qBittorrent's default folder (${root}/${categoryName || 'name'}). A folder of its own must be inside ${root}.`
            : "Leave it empty for qBittorrent's default folder."}
        >
          <div className="grouped-row">
            <Input
              value={savePath ?? ''}
              onChange={(e) => setSavePath(e.target.value)}
              placeholder={root ? `${root}/${categoryName || 'name'}` : 'Default folder'}
              aria-label="Save path"
              disabled={saving || removing}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        </GroupedSection>

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
        description={arrWarning ? (
          <>
            {arrWarning.uses.map((use) => (
              <span key={`${use.instance}|${use.downloadClient}|${use.category}`} className="block">
                {use.instance === use.app ? use.app : `${use.app} (${use.instance})`} uses {use.category} in its download client {use.downloadClient}.
              </span>
            ))}
            {arrWarning.unchecked.length > 0 && (
              <span className="block">Did not answer, so not checked: {arrWarning.unchecked.join(', ')}.</span>
            )}
            <span className="block mt-2">
              Removing it stops their imports until their download client gets another category.
            </span>
          </>
        ) : (
          <>
            <span className="block">Torrents in it lose the category. Their files stay where they are.</span>
            {subcategories.length > 0 && (
              <span className="block mt-2">Its subcategories go too: {subcategories.join(', ')}.</span>
            )}
          </>
        )}
        confirmLabel={arrWarning ? 'Remove Anyway' : 'Remove'}
        destructive
        busy={removing}
        onConfirm={remove}
      />
    </div>
  );
}
