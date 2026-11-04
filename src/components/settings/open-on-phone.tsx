'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { phoneLinkKind, qrModules } from '@/lib/phone-link';

const emptySubscribe = () => () => {};
const getOrigin = () => window.location.origin;

/** The code, black on white with a quiet zone, so a camera reads it on any theme. */
function QrCode({ text }: { text: string }) {
  const modules = useMemo(() => qrModules(text), [text]);
  const quiet = 4;
  const size = modules.length + quiet * 2;
  const path = modules
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : '')))
    .join('');
  return (
    <svg
      role="img"
      aria-label={`QR code for ${text}`}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="h-52 w-52 rounded-lg"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

function Steps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div>
      <div className="text-sm font-medium">{title}</div>
      <ol className="mt-1 space-y-0.5 text-xs text-muted-foreground list-decimal pl-4">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

/** "Open on your phone": a QR code of this address, with install steps for iPhone and Android. */
export function OpenOnPhoneDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const origin = useSyncExternalStore(emptySubscribe, getOrigin, () => '');
  const kind = origin ? phoneLinkKind(origin) : null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Open on your phone</DrawerTitle>
          <DrawerDescription>
            {kind === 'loopback'
              ? 'This address only works on this computer.'
              : 'Point the phone\'s camera at the code, then open the link.'}
          </DrawerDescription>
        </DrawerHeader>
        {/* One centred column, so a wide screen does not spread it edge to edge. */}
        <div className="mx-auto w-full max-w-md px-6 pb-2 space-y-4 overflow-y-auto">
          {kind === 'loopback' ? (
            <p className="text-sm text-muted-foreground">
              {origin} is this computer, so a phone cannot open it. Open Helprr in this browser at this computer&apos;s
              address on your network instead, such as <span className="font-mono">http://192.168.1.10:3050</span> (your
              router lists it), and the code will be there.
            </p>
          ) : origin ? (
            <>
              <div className="flex flex-col items-center gap-2">
                <QrCode text={origin} />
                <span className="font-mono text-xs text-muted-foreground select-all break-all text-center">{origin}</span>
              </div>
              {kind === 'local' && (
                <p className="text-xs text-orange-700 dark:text-orange-400">
                  The phone must be on the same network as Helprr. Push notifications need an https:// address; see
                  Settings → Notifications → Check push setup.
                </p>
              )}
              <Steps
                title="iPhone and iPad"
                steps={['Open the link in Safari.', 'Tap Share, then "Add to Home Screen", then Add.', 'Open Helprr from the Home Screen.']}
              />
              <Steps
                title="Android"
                steps={['Open the link in Chrome.', 'Tap the menu (⋮), then "Install app" or "Add to Home screen".', 'Open Helprr from the home screen.']}
              />
            </>
          ) : null}
        </div>
        <DrawerFooter className="mx-auto w-full max-w-md">
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">Done</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
