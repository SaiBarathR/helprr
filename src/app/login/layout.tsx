import { DemoBanner } from '@/components/layout/demo-banner';
import { isDemo } from '@/lib/demo';

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  if (!isDemo()) return children;
  return (
    <>
      {/* In the page, not fixed, so it never covers the form on a short screen. */}
      <div className="mx-auto max-w-md px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
        <DemoBanner signIn />
      </div>
      {children}
    </>
  );
}
