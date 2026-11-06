// Inlined at build time (see next.config.ts `env`) — identifies the running build.
// Release images carry the tag ("v1.6.3"); show it as the update notice does ("1.6.3").
export const APP_VERSION = (process.env.NEXT_PUBLIC_APP_VERSION || 'unknown').replace(/^v(?=\d)/, '');
export const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA || '';
