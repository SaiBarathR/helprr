import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeApplier } from '@/components/theme-applier';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/dashboard-theme';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { ClientLogCapture } from '@/components/client-log-capture';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Helprr',
  description: 'Media management dashboard for Sonarr, Radarr & qBittorrent',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Helprr',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Per-request CSP script nonce from the middleware. Reading headers() also
  // forces dynamic rendering app-wide — required for nonce-based CSP, since a
  // static prerender can't carry a per-request nonce in its inline scripts.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        {/* Blocking, pre-hydration: replays the persisted resolved theme onto
            <html> before first paint so a non-default theme doesn't snap. Must
            stay the first body child (runs before any themed markup parses). */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
        <ThemeApplier />
        <TooltipProvider delayDuration={300}>
          {children}
        </TooltipProvider>
        <Toaster />
        <ServiceWorkerRegister />
        <ClientLogCapture />
      </body>
    </html>
  );
}
