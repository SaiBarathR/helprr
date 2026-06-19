import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
  // Serwist defaults this to true, injecting a `window.online → location.reload()`
  // listener into the prod bundle. Over the Cloudflare tunnel an iOS PWA flaps
  // online/offline (esp. when switching servers), firing repeated full reloads —
  // the flicker/reload loop. TanStack's refetchOnReconnect already refreshes data
  // in place, so the reload is pure churn.
  reloadOnOnline: false,
});

const nextConfig: NextConfig = {
  output: 'standalone',
  // Force webpack for Serwist compatibility
  turbopack: {},
  // sharp ships a native .node binary; keep webpack from trying to bundle it so
  // the standalone build can load it at runtime.
  serverExternalPackages: ['sharp'],
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: '**' },
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default withSerwist(nextConfig);
