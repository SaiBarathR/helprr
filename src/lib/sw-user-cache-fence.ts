import type { SerwistPlugin } from 'serwist';

/**
 * A fence for the service worker's user-scoped caches. Every user-scoped
 * clear (sign-out, a revoked session, sign-in) moves the fence to a new epoch;
 * a response is written only if no clear happened since its request started.
 * Without it, a poster or page-shell fetch authorized for the old session
 * that outlasts the clear writes into the cache again, recreating it for the
 * next person to sign in.
 */
export function createUserCacheFence() {
  let epoch = 0;
  const plugin: SerwistPlugin = {
    handlerWillStart: async ({ state }) => {
      if (state) state.userCacheEpoch = epoch;
    },
    cacheWillUpdate: async ({ response, state }) => (state?.userCacheEpoch === epoch ? response : null),
    // A clear that landed while the write was under way: take this entry back out.
    cacheDidUpdate: async ({ cacheName, request, state }) => {
      if (state?.userCacheEpoch === epoch) return;
      await (await caches.open(cacheName)).delete(request);
    },
  };
  return {
    plugin,
    advance() {
      epoch += 1;
    },
  };
}
