'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/lib/store';
import { NAV_ITEM_MAP } from '@/lib/nav-config';

/**
 * Client component that performs a client-side redirect to the user's configured default page.
 *
 * On mount and whenever the UI store's `defaultPage` changes, navigates to the route mapped from `defaultPage`, falling back to `'/dashboard'` if no mapping exists.
 *
 * @returns The rendered React node — always `null`.
 */
export default function Home() {
  const router = useRouter();
  const defaultPage = useUIStore((s) => s.defaultPage);

  useEffect(() => {
    const href = NAV_ITEM_MAP[defaultPage]?.href ?? '/dashboard';
    router.replace(href);
  }, [defaultPage, router]);

  return null;
}