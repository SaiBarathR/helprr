'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/lib/store';
import { resolveDefaultPageHref } from '@/lib/nav-config';

/**
 * Client component that performs a client-side redirect to the user's configured default page.
 *
 * After persisted UI preferences hydrate, resolves the effective default route from navigation
 * settings and redirects there.
 *
 * @returns The rendered React node — always `null`.
 */
export default function Home() {
  const router = useRouter();
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);
  const defaultPage = useUIStore((s) => s.defaultPage);
  const hydrated = useUIStore((s) => s.hasHydrated);

  useEffect(() => {
    if (!hydrated) return;
    const href = resolveDefaultPageHref({
      defaultPage,
      navOrder,
      disabledNavItems,
    });
    router.replace(href);
  }, [defaultPage, disabledNavItems, hydrated, navOrder, router]);

  return null;
}
