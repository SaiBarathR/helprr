'use client';

import { Button } from '@/components/ui/button';
import type { QbitInstance } from './use-qbit-instance';

/** A link names a qBittorrent removed since: say so, and offer the ones still connected. */
export function QbitGone({ instances, onShow }: { instances: QbitInstance[]; onShow: (id: string) => void }) {
  return (
    <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
      <p>This qBittorrent is no longer connected to Helprr.</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {instances.map((instance) => (
          <Button key={instance.id} variant="outline" size="sm" className="min-h-11" onClick={() => onShow(instance.id)}>
            Show {instance.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
