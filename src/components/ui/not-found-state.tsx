import { SearchX } from 'lucide-react';

/**
 * A detail page whose item doesn't exist (a confirmed 404, never a failed
 * fetch — that is ErrorState). Pages render it under their PageHeader, so
 * Back still works, in the same centred look as ErrorState and the empty
 * lists.
 */
export function NotFoundState({ message }: { message: string }) {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <SearchX className="h-8 w-8 mx-auto mb-2 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
