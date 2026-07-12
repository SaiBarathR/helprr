import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';
import pkg from './package.json';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

const nextConfig: NextConfig = {
  // Version identity, shown in Settings → Status. Baked in at build time on
  // purpose — unlike the VAPID key this is a property of the build itself.
  // Docker builds override via APP_VERSION/GIT_SHA build args (CI passes the
  // image tag + commit); source builds fall back to package.json.
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION || pkg.version,
    NEXT_PUBLIC_GIT_SHA: process.env.GIT_SHA || '',
  },
  // Dev-only: extra origins allowed to reach the dev server (LAN IP, Tailscale
  // hostname, etc.). Comma-separated, set in .env.local — never used in production.
  ...(process.env.ALLOWED_DEV_ORIGINS
    ? {
        allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      }
    : {}),
  output: 'standalone',
  // Force webpack for Serwist compatibility
  turbopack: {},
  // sharp ships a native .node binary; keep webpack from trying to bundle it so
  // the standalone build can load it at runtime.
  serverExternalPackages: ['sharp'],
  images: {
    // Explicit allowlist — a wildcard here turns /_next/image into an open
    // image proxy / SSRF probe (the optimizer route is unauthenticated). Almost
    // all remote images are already proxied same-origin through /api/image
    // (which enforces its own host allowlist + private-host blocking) or are
    // rendered `unoptimized`; these hosts cover the few the optimizer may fetch
    // directly. Keep in sync with DEFAULT_EXTERNAL_IMAGE_HOSTS in
    // src/app/api/image/route.ts.
    remotePatterns: [
      { protocol: 'https', hostname: 'image.tmdb.org' },
      { protocol: 'https', hostname: 'artworks.thetvdb.com' },
      { protocol: 'https', hostname: 'thetvdb.com' },
      { protocol: 'https', hostname: 'www.thetvdb.com' },
      { protocol: 'https', hostname: 'fanart.tv' },
      { protocol: 'https', hostname: 'assets.fanart.tv' },
      { protocol: 'https', hostname: 'static.tvmaze.com' },
      { protocol: 'https', hostname: 's1.anilist.co' },
      { protocol: 'https', hostname: 's2.anilist.co' },
      { protocol: 'https', hostname: 's3.anilist.co' },
      { protocol: 'https', hostname: 's4.anilist.co' },
      { protocol: 'https', hostname: 'images.lidarr.audio' },
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: 'i.ytimg.com' },
    ],
  },
};

export default withSerwist(nextConfig);
