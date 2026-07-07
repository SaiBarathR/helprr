'use client';

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { useIsStandalone } from '@/hooks/use-is-standalone';

type Platform = 'ios' | 'android' | 'desktop';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Platform never changes within a session, so the store never emits.
const emptySubscribe = () => () => {};

function getPlatform(): Platform {
  const ua = navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

export function useInstallPrompt() {
  const standaloneDisplay = useIsStandalone();
  // Installing doesn't flip the current tab's display-mode, so track the
  // appinstalled event separately to hide install prompts right away.
  const [installed, setInstalled] = useState(false);
  const platform = useSyncExternalStore(emptySubscribe, getPlatform, () => 'desktop');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // beforeinstallprompt lifecycle
    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const canPrompt = deferredPrompt !== null;

  const triggerInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
    return outcome === 'accepted';
  }, [deferredPrompt]);

  return { isStandalone: standaloneDisplay || installed, platform, canPrompt, triggerInstall };
}
