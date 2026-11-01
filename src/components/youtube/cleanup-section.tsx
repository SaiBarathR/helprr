'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SwitchRow } from '@/components/creators/setting-rows';
import { GroupedSection } from '@/components/settings/grouped-section';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Cleanup {
  enabled: boolean;
  viewerId: string | null;
  status: string | null;
  users: Array<{ id: string; name: string }> | null;
}

const QUERY_KEY = ['youtube', 'cleanup'];

export function CleanupSection() {
  const queryClient = useQueryClient();
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [confirmOn, setConfirmOn] = useState(false);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/youtube/cleanup', { signal });
      if (!res.ok) throw new Error('Could not load cleanup');
      return (await res.json()) as Cleanup;
    },
  });
  const save = useMutation({
    mutationFn: async (body: { enabled: boolean; viewerId?: string | null }) => {
      const res = await fetch('/api/youtube/cleanup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not save');
    },
    onSuccess: () => {
      setConfirmOn(false);
      void queryClient.invalidateQueries({ queryKey: ['youtube'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const data = query.data;
  if (!data) return null;
  const viewer = viewerId ?? data.viewerId;
  const footer = data.status
    ?? (data.enabled ? 'A video clears 3 days after it is watched. Keep forever always wins.' : 'Off: nothing is deleted by itself');

  return (
    <GroupedSection title="Automatic cleanup" footer={footer}>
      <div className="grouped-row gap-3">
        <Label className="shrink-0 text-sm font-normal">Whose watching counts</Label>
        <Select value={viewer ?? undefined} disabled={data.enabled || !data.users} onValueChange={setViewerId}>
          <SelectTrigger aria-label="Whose watching counts" className="h-auto w-auto gap-1 border-0 bg-transparent px-2 py-1 text-sm text-muted-foreground shadow-none focus:ring-0">
            <SelectValue placeholder={data.users ? 'Choose' : 'Jellyfin is away'} />
          </SelectTrigger>
          <SelectContent>
            {data.users?.map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <SwitchRow
        label="Clear watched videos"
        checked={data.enabled}
        disabled={save.isPending || (!data.enabled && !viewer)}
        onCheckedChange={(checked) => (checked ? setConfirmOn(true) : save.mutate({ enabled: false }))}
      />
      <ConfirmDialog
        open={confirmOn}
        onOpenChange={setConfirmOn}
        title="Clear watched videos automatically?"
        description="Files are deleted from disk 3 days after this person watches them. You can keep any video forever, and anything cleared can be downloaded again."
        confirmLabel="Turn on"
        destructive
        busy={save.isPending}
        onConfirm={() => save.mutate({ enabled: true, viewerId: viewer })}
      />
    </GroupedSection>
  );
}
