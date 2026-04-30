import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Fraunces, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { ServiceWorkerRegister } from '@/components/sw-register';
import { AccentApplier } from '@/components/accent-applier';
import './globals.css';

// Body — Bricolage Grotesque with full optical-size variable axis.
// Distinctive ink-trapped grotesque, tightens at small sizes, blooms at display sizes.
const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
  display: 'swap',
  axes: ['opsz'],
});

// Display — Fraunces. Editorial serif used for hero titles and section eyebrows.
const fraunces = Fraunces({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});

// Mono — JetBrains Mono, tabular-aligned for status grids and counters.
const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono-stack',
  subsets: ['latin'],
  display: 'swap',
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${bricolage.variable} ${fraunces.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <AccentApplier />
          <TooltipProvider delayDuration={300}>
            {children}
          </TooltipProvider>
          <Toaster />
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
