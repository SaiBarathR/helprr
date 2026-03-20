import { Loader2 } from 'lucide-react';

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-32 animate-spinner-in">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
