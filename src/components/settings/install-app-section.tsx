'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronRight, QrCode, Share, SquarePlus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryRow } from '@/components/settings/category-row';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from '@/components/ui/drawer';
import { useInstallPrompt } from '@/hooks/use-install-prompt';
import dynamic from 'next/dynamic';

// Loaded on first open: it carries the QR encoder.
const OpenOnPhoneDrawer = dynamic(
  () => import('@/components/settings/open-on-phone').then((module) => module.OpenOnPhoneDrawer),
  { loading: () => null },
);

export function InstallAppSection() {
  const { isStandalone, platform, canPrompt, triggerInstall } = useInstallPrompt();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  // Kept mounted once opened, so closing plays the drawer's slide-down.
  const [phoneOpened, setPhoneOpened] = useState(false);

  async function handleInstallTap() {
    if (platform === 'ios') {
      setDrawerOpen(true);
    } else if (canPrompt) {
      try {
        const accepted = await triggerInstall();
        setDrawerOpen(false);

        if (accepted) {
          toast.success('Install prompt accepted.');
        } else {
          toast.info('Install prompt dismissed.');
        }
      } catch {
        toast.error('Unable to show install prompt. Please try again.');
      }
    } else {
      toast.info('Use your browser menu to add this app to your home screen.');
    }
  }

  if (isStandalone) {
    return (
      <div id="install" className="grouped-section px-4 mb-6 scroll-mt-20">
        <div className="grouped-section-title">App</div>
        <div className="grouped-section-content">
          <div className="grouped-row">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span className="text-sm font-medium">Installed</span>
            </div>
            <Check className="h-4 w-4 text-green-500" />
          </div>
          <CategoryRow
            href="/settings/shortcuts"
            icon={Zap}
            iconBg="bg-amber-500/10"
            iconColor="text-amber-400"
            label="Siri Shortcuts"
            subtitle="Automate Helprr from the Shortcuts app"
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div id="install" className="grouped-section mb-6 scroll-mt-20">
        <div className="grouped-section-title">App</div>
        <div className="grouped-section-content">
          <button
            onClick={handleInstallTap}
            className="grouped-row w-full active:bg-foreground/5 transition-colors"
          >
            <div className="flex flex-col items-start">
              <span className="text-sm font-medium">Install App</span>
              <span className="text-xs text-muted-foreground">Add to Home Screen</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
          {platform === 'desktop' && (
            <button
              onClick={() => {
                setPhoneOpened(true);
                setPhoneOpen(true);
              }}
              className="grouped-row w-full active:bg-foreground/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <QrCode className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <div className="flex flex-col items-start">
                  <span className="text-sm font-medium">Open on your phone</span>
                  <span className="text-xs text-muted-foreground">Scan a code instead of typing the address</span>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
          <CategoryRow
            href="/settings/shortcuts"
            icon={Zap}
            iconBg="bg-amber-500/10"
            iconColor="text-amber-400"
            label="Siri Shortcuts"
            subtitle="Automate Helprr from the Shortcuts app"
          />
        </div>
      </div>

      {phoneOpened && <OpenOnPhoneDrawer open={phoneOpen} onOpenChange={setPhoneOpen} />}

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Install Helprr</DrawerTitle>
          </DrawerHeader>
          <div className="px-6 pb-2 space-y-5">
            <div className="flex items-start gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">1</span>
              <p className="text-sm pt-1">
                Tap the <Share className="inline h-4 w-4 align-text-bottom mx-0.5" /> <strong>Share</strong> button in the toolbar
              </p>
            </div>
            <div className="flex items-start gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">2</span>
              <p className="text-sm pt-1">
                Scroll down and tap <SquarePlus className="inline h-4 w-4 align-text-bottom mx-0.5" /> <strong>Add to Home Screen</strong>
              </p>
            </div>
            <div className="flex items-start gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">3</span>
              <p className="text-sm pt-1">
                Tap <strong>Add</strong> in the top right corner
              </p>
            </div>
          </div>
          <DrawerFooter>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Got it</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </>
  );
}
