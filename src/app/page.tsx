'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/lib/store';
import { NAV_ITEM_MAP } from '@/lib/nav-config';

export default function Home() {
  const router = useRouter();
  const defaultPage = useUIStore((s) => s.defaultPage);

  useEffect(() => {
    const href = NAV_ITEM_MAP[defaultPage]?.href ?? '/dashboard';
    router.replace(href);
  }, [defaultPage, router]);

  return null;
}
