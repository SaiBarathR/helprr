import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getVapidPublicKey, missingVapidVariables } from '@/lib/vapid';
import { withApiLogging } from '@/lib/api-logger';

// Serves the install's VAPID public key at runtime so the prebuilt image works
// without baking the key in at build time. `publicKey` is null when Web Push
// isn't configured; clients surface that as "not configured". `configured` is
// true only when all three VAPID values are set, since push sends nothing
// otherwise; admins also get the missing variable names, to fix it.
async function getHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const missing = missingVapidVariables();
  return NextResponse.json({
    publicKey: getVapidPublicKey(),
    configured: missing.length === 0,
    ...(auth.user.role === 'admin' && missing.length > 0 && { missing }),
  });
}

export const GET = withApiLogging(getHandler, 'api/push/public-key');
