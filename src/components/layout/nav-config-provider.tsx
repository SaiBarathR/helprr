'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  buildEffectiveNav,
  DEFAULT_NAV_CONFIG,
  normalizeNavConfig,
  type EffectiveNav,
  type NavConfigV1,
} from '@/lib/navigation-config';

interface NavConfigContextValue {
  navConfig: NavConfigV1;
  effectiveNav: EffectiveNav;
  setNavConfig: (next: NavConfigV1) => void;
}

const NavConfigContext = createContext<NavConfigContextValue | null>(null);

export function NavConfigProvider({ children }: { children: ReactNode }) {
  const [navConfig, setNavConfigState] = useState<NavConfigV1>(DEFAULT_NAV_CONFIG);

  useEffect(() => {
    let cancelled = false;

    async function loadNavConfig() {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) return;
        const settings = await res.json();
        if (!cancelled) {
          setNavConfigState(normalizeNavConfig(settings?.navConfig));
        }
      } catch {
        // Keep defaults when settings are unavailable
      }
    }

    loadNavConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const setNavConfig = useCallback((next: NavConfigV1) => {
    setNavConfigState(normalizeNavConfig(next));
  }, []);

  const effectiveNav = useMemo(() => buildEffectiveNav(navConfig), [navConfig]);

  const value = useMemo(
    () => ({
      navConfig,
      effectiveNav,
      setNavConfig,
    }),
    [effectiveNav, navConfig, setNavConfig]
  );

  return <NavConfigContext.Provider value={value}>{children}</NavConfigContext.Provider>;
}

export function useNavConfig() {
  const context = useContext(NavConfigContext);
  if (!context) {
    throw new Error('useNavConfig must be used within NavConfigProvider');
  }
  return context;
}
