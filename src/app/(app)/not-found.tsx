import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Branded 404 for the authenticated shell. Also serves notFound() from the
// capability page guards, so the copy stays neutral between "doesn't exist"
// and "no access".
export default function AppNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <FileQuestion className="h-10 w-10 text-muted-foreground" />
      <div>
        <h2 className="text-lg font-semibold">Page not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This page doesn&apos;t exist or you don&apos;t have access to it.
        </p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to Dashboard</Link>
      </Button>
    </div>
  );
}
